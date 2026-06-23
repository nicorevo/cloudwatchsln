const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const FileManager = require('../src/file-manager');

function createLogger() {
    return {
        debug() {},
        info() {},
        error() {}
    };
}

async function withFileManager(patterns, callback) {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-'));
    const manager = new FileManager({
        cloudwatch: {
            monitorPatterns: [],
            exceptionPatterns: patterns.exceptionPatterns,
            excludeExceptionPatterns: patterns.excludeExceptionPatterns
        },
        files: {
            logDirectory,
            filePrefix: 'sample-service',
            retentionMinutes: 60,
            preserveExceptionPairs: true
        }
    }, createLogger());

    try {
        return await callback(manager, logDirectory);
    } finally {
        await fs.remove(logDirectory);
    }
}

function event(message, overrides = {}) {
    return {
        timestamp: Date.parse('2026-06-23T08:00:00.000Z'),
        logGroupName: '/eks/example',
        logStreamName: 'stream',
        message,
        ...overrides
    };
}

test('scrive nel file eccezioni solo righe incluse e non escluse', async () => {
    await withFileManager({
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: ['Known harmless error']
    }, async (manager, logDirectory) => {
        await manager.writeLogsToFile([
            event('ERROR database unavailable'),
            event('ERROR Known harmless error'),
            event('request completed')
        ]);

        const files = await fs.readdir(logDirectory);
        const mainFile = files.find(filename =>
            filename.startsWith('sample-service_')
        );
        const exceptionFile = files.find(filename =>
            filename.startsWith('sample-service-exceptions_')
        );
        const main = await fs.readFile(path.join(logDirectory, mainFile), 'utf8');
        const exceptions = await fs.readFile(
            path.join(logDirectory, exceptionFile),
            'utf8'
        );

        assert.match(main, /ERROR database unavailable/);
        assert.match(main, /ERROR Known harmless error/);
        assert.match(main, /request completed/);
        assert.match(exceptions, /ERROR database unavailable/);
        assert.doesNotMatch(exceptions, /Known harmless error/);
    });
});

test('non crea file eccezioni quando tutte le candidate sono escluse', async () => {
    await withFileManager({
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: ['Known harmless error']
    }, async (manager, logDirectory) => {
        await manager.writeLogsToFile([
            event('ERROR Known harmless error')
        ]);

        const files = await fs.readdir(logDirectory);
        assert.ok(files.some(filename => filename.startsWith('sample-service_')));
        assert.equal(
            files.some(filename => filename.startsWith('sample-service-exceptions_')),
            false
        );
    });
});

test('applica gli exclude al body log estratto dal payload JSON', async () => {
    await withFileManager({
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: ['Known harmless error']
    }, async (manager, logDirectory) => {
        await manager.writeLogsToFile([
            event(JSON.stringify({
                log: 'ERROR Known harmless error\n',
                kubernetes: { container_name: 'api' }
            }))
        ]);

        const files = await fs.readdir(logDirectory);
        const mainFile = files.find(filename =>
            filename.startsWith('sample-service_')
        );
        const main = await fs.readFile(path.join(logDirectory, mainFile), 'utf8');

        assert.match(main, /\[\/eks\/example \| api\] ERROR Known harmless error/);
        assert.equal(
            files.some(filename => filename.startsWith('sample-service-exceptions_')),
            false
        );
    });
});
