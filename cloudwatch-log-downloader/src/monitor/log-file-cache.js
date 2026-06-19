const fs = require('fs-extra');
const path = require('path');

class LogFileCache {
    constructor() {
        this.entries = new Map();
    }

    async readLines(filePath) {
        const stats = await fs.stat(filePath);
        const cached = this.entries.get(filePath);

        if (cached && cached.mtimeMs === stats.mtimeMs) {
            return cached.lines;
        }

        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        this.entries.set(filePath, {
            mtimeMs: stats.mtimeMs,
            lines
        });

        return lines;
    }

    clear() {
        this.entries.clear();
    }
}

module.exports = LogFileCache;
