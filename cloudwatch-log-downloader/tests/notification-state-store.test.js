const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const NotificationStateStore = require('../src/notifications/notification-state-store');

function createLogger() {
    const calls = [];
    return {
        calls,
        info(message, data) { calls.push({ level: 'info', message, data }); },
        warn(message, data) { calls.push({ level: 'warn', message, data }); },
        error(message, data) { calls.push({ level: 'error', message, data }); }
    };
}

test('NotificationStateStore riserva, persiste e ricarica esiti terminali', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-state-'));
    const filePath = path.join(directory, '.state.json');
    const now = Date.parse('2026-06-23T10:00:00.000Z');

    try {
        const first = new NotificationStateStore(filePath, createLogger(), {
            now: () => now
        });
        await first.init();

        assert.equal(first.reserve('notification-a'), true);
        assert.equal(first.reserve('notification-a'), false);
        await first.complete('notification-a', 'sent');

        const second = new NotificationStateStore(filePath, createLogger(), {
            now: () => now + 1000
        });
        await second.init();

        assert.equal(second.reserve('notification-a'), false);
        const state = await fs.readJson(filePath);
        assert.equal(state.entries['notification-a'].status, 'sent');
    } finally {
        await fs.remove(directory);
    }
});

test('NotificationStateStore elimina gli esiti oltre la retention', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-state-'));
    const filePath = path.join(directory, '.state.json');
    const now = Date.parse('2026-06-23T10:00:00.000Z');

    try {
        await fs.writeJson(filePath, {
            version: 1,
            entries: {
                old: { status: 'sent', updatedAt: now - (25 * 60 * 60 * 1000) },
                recent: { status: 'failed', updatedAt: now - 1000 }
            }
        });

        const store = new NotificationStateStore(filePath, createLogger(), {
            now: () => now
        });
        await store.init();

        assert.equal(store.reserve('old'), true);
        assert.equal(store.reserve('recent'), false);
        await store.flush();
        const state = await fs.readJson(filePath);
        assert.equal(state.entries.old, undefined);
        assert.equal(state.entries.recent.status, 'failed');
    } finally {
        await fs.remove(directory);
    }
});

test('NotificationStateStore isola un file corrotto e riparte vuoto', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-state-'));
    const filePath = path.join(directory, '.state.json');
    const logger = createLogger();

    try {
        await fs.writeFile(filePath, '{broken');
        const store = new NotificationStateStore(filePath, logger, {
            now: () => Date.parse('2026-06-23T10:00:00.000Z')
        });

        await store.init();

        assert.equal(store.reserve('new'), true);
        const files = await fs.readdir(directory);
        assert.ok(files.some(name => name.startsWith('.state.json.corrupt-')));
        assert.ok(logger.calls.some(call =>
            call.level === 'error' && call.message.includes('stato notifiche corrotto')
        ));
    } finally {
        await fs.remove(directory);
    }
});

test('NotificationStateStore riprende a scrivere dopo un errore transitorio', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-state-'));
    const filePath = path.join(directory, '.state.json');
    let shouldFail = true;
    const resilientFs = {
        ...fs,
        async writeJson(...args) {
            if (shouldFail) {
                shouldFail = false;
                throw new Error('disk temporarily unavailable');
            }
            return fs.writeJson(...args);
        }
    };
    const store = new NotificationStateStore(filePath, createLogger(), {
        fs: resilientFs,
        now: () => Date.parse('2026-06-23T10:00:00.000Z')
    });

    try {
        await store.init();
        assert.equal(store.reserve('first'), true);
        await assert.rejects(() => store.complete('first', 'sent'));

        assert.equal(store.reserve('second'), true);
        await store.complete('second', 'sent');

        const state = await fs.readJson(filePath);
        assert.equal(state.entries.first.status, 'sent');
        assert.equal(state.entries.second.status, 'sent');
    } finally {
        await fs.remove(directory);
    }
});
