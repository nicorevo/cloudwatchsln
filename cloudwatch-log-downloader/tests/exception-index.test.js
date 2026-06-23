const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ExceptionIndex = require('../src/monitor/exception-index');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const MONITOR_CONFIG = {
    maxExceptionFiles: 50
};

test('buildTree returns files and exception leaves', async () => {
    const index = new ExceptionIndex(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR, {
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: []
    });
    const tree = await index.buildTree();

    assert.ok(tree.files.length >= 1);
    const fixtureFile = tree.files.find(file => file.id === 'fixture');
    assert.ok(fixtureFile);
    assert.equal(fixtureFile.exceptionCount, 2);
    assert.equal(fixtureFile.exceptions[0].id, 'fixture:1');
    assert.equal(fixtureFile.exceptions[1].lineNumberInMain, 15);
});

test('buildTree filtra righe storiche mantenendo indici fisici e limit sui file visibili', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'exception-index-'));

    try {
        await fs.writeFile(
            path.join(logDirectory, `${FILE_PREFIX}-exceptions_z-new.log`),
            '[2026-06-23T08:03:00.000Z] [group] ERROR Known harmless error\n'
        );
        await fs.writeFile(
            path.join(logDirectory, `${FILE_PREFIX}-exceptions_a-old.log`),
            [
                '[2026-06-23T08:00:00.000Z] [group] ERROR first',
                '[2026-06-23T08:01:00.000Z] [group] ERROR Known harmless error',
                '[2026-06-23T08:02:00.000Z] [group] ERROR third'
            ].join('\n')
        );

        const index = new ExceptionIndex(
            { maxExceptionFiles: 50 },
            FILE_PREFIX,
            logDirectory,
            {
                exceptionPatterns: ['ERROR'],
                excludeExceptionPatterns: ['Known harmless error']
            }
        );
        const tree = await index.buildTree(1);

        assert.equal(tree.files.length, 1);
        assert.equal(tree.files[0].id, 'a-old');
        assert.deepEqual(
            tree.files[0].exceptions.map(exception => exception.id),
            ['a-old:1', 'a-old:3']
        );
        assert.equal(await index.countExceptionFiles(), 1);
    } finally {
        await fs.remove(logDirectory);
    }
});
