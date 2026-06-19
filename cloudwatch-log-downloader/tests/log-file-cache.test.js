const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const LogFileCache = require('../src/monitor/log-file-cache');

test('LogFileCache reuses lines when mtime is unchanged', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-cache-'));
    const filePath = path.join(tempDir, 'sample.log');

    await fs.writeFile(filePath, 'line-1\nline-2');
    const cache = new LogFileCache();
    const firstRead = await cache.readLines(filePath);

    let readCount = 0;
    const originalReadFile = fs.readFile.bind(fs);
    fs.readFile = async (...args) => {
        readCount += 1;
        return originalReadFile(...args);
    };

    const secondRead = await cache.readLines(filePath);

    assert.deepEqual(firstRead, ['line-1', 'line-2']);
    assert.deepEqual(secondRead, ['line-1', 'line-2']);
    assert.equal(readCount, 0);

    fs.readFile = originalReadFile;
    await fs.remove(tempDir);
});
