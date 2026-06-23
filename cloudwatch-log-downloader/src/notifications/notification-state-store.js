const fs = require('fs-extra');
const path = require('path');

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

class NotificationStateStore {
    constructor(filePath, logger, options = {}) {
        this.filePath = filePath;
        this.logger = logger;
        this.now = options.now ?? Date.now;
        this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
        this.fs = options.fs ?? fs;
        this.entries = new Map();
        this.reservations = new Set();
        this.writeQueue = Promise.resolve();
    }

    async init() {
        await this.fs.ensureDir(path.dirname(this.filePath));
        if (!await this.fs.pathExists(this.filePath)) {
            return;
        }

        try {
            const state = await this.fs.readJson(this.filePath);
            if (state?.version !== 1 || !state.entries || typeof state.entries !== 'object') {
                throw new Error('formato non supportato');
            }
            for (const [key, entry] of Object.entries(state.entries)) {
                if (
                    (entry.status === 'sent' || entry.status === 'failed')
                    && Number.isFinite(entry.updatedAt)
                ) {
                    this.entries.set(key, entry);
                }
            }
            this.prune();
        } catch (error) {
            const corruptPath = `${this.filePath}.corrupt-${this.now()}`;
            await this.fs.move(this.filePath, corruptPath, { overwrite: false });
            this.entries.clear();
            this.logger.error('File stato notifiche corrotto: isolato e ricreato', {
                filename: path.basename(this.filePath),
                message: error.message
            });
        }
    }

    prune() {
        const cutoff = this.now() - this.retentionMs;
        for (const [key, entry] of this.entries) {
            if (entry.updatedAt < cutoff) {
                this.entries.delete(key);
            }
        }
    }

    reserve(key) {
        if (this.entries.has(key) || this.reservations.has(key)) {
            return false;
        }
        this.reservations.add(key);
        return true;
    }

    async complete(key, status) {
        if (status !== 'sent' && status !== 'failed') {
            throw new Error(`Stato notifica non valido: ${status}`);
        }
        this.reservations.delete(key);
        this.entries.set(key, {
            status,
            updatedAt: this.now()
        });
        await this.flush();
    }

    async flush() {
        this.prune();
        this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
            const temporaryPath = `${this.filePath}.tmp`;
            const entries = Object.fromEntries(this.entries);
            await this.fs.writeJson(temporaryPath, { version: 1, entries });
            await this.fs.rename(temporaryPath, this.filePath);
        });
        return this.writeQueue;
    }
}

module.exports = NotificationStateStore;
module.exports.DEFAULT_RETENTION_MS = DEFAULT_RETENTION_MS;
