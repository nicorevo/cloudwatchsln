const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ExceptionContext = require('../src/monitor/exception-context');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const MONITOR_CONFIG = {
    contextLinesBefore: 10,
    contextLinesAfter: 10
};

test('resolveExceptionContext returns context around second exception', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR, {
        exceptionPatterns: ['ERROR']
    });
    const result = await contextService.resolveExceptionContext('fixture:2');

    assert.equal(result.exception.lineNumberInMain, 15);
    assert.equal(result.context.before.length, 10);
    assert.equal(result.context.after.length, 5);
    assert.equal(result.context.before[0].lineNumber, 5);
    assert.equal(result.context.after[result.context.after.length - 1].lineNumber, 20);
});

test('resolveExceptionContext uses first duplicate match in main file', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR, {
        exceptionPatterns: ['ERROR']
    });
    const result = await contextService.resolveExceptionContext('fixture:1');

    assert.equal(result.exception.lineNumberInMain, 5);
});

test('resolveExceptionContext warns when main file is missing', async () => {
    const contextService = new ExceptionContext(
        MONITOR_CONFIG,
        FILE_PREFIX,
        FIXTURE_DIR,
        { exceptionPatterns: ['ERROR'] }
    );

    const result = await contextService.resolveExceptionContext('orphan:1');

    assert.equal(result.warning, 'main_file_missing');
    assert.deepEqual(result.context.before, []);
    assert.deepEqual(result.context.after, []);
});

test('resolveExceptionContext rejects invalid id', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR, {
        exceptionPatterns: ['ERROR']
    });

    await assert.rejects(
        () => contextService.resolveExceptionContext('invalid-id'),
        error => error.code === 'INVALID_ID'
    );
});

test('resolveExceptionContext rejects missing exception file prefix', async () => {
    const contextService = new ExceptionContext(
        MONITOR_CONFIG,
        'missing-prefix',
        FIXTURE_DIR,
        { exceptionPatterns: ['ERROR'] }
    );

    await assert.rejects(
        () => contextService.resolveExceptionContext('fixture:1'),
        error => error.code === 'NOT_FOUND'
    );
});

test('resolveExceptionContext rifiuta una riga esclusa senza rinumerare le altre', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'exception-context-'));
    const prefix = 'sample-service';

    try {
        await fs.writeFile(
            path.join(logDirectory, `${prefix}-exceptions_fixture.log`),
            [
                '[2026-06-23T08:00:00.000Z] [group] ERROR first',
                '[2026-06-23T08:01:00.000Z] [group] ERROR Known harmless error',
                '[2026-06-23T08:02:00.000Z] [group] ERROR third'
            ].join('\n')
        );

        const contextService = new ExceptionContext(
            MONITOR_CONFIG,
            prefix,
            logDirectory,
            {
                exceptionPatterns: ['ERROR'],
                excludeExceptionPatterns: ['Known harmless error']
            }
        );

        await assert.rejects(
            () => contextService.resolveExceptionContext('fixture:2'),
            error => error.code === 'NOT_FOUND'
        );

        const allowed = await contextService.resolveExceptionContext('fixture:3');
        assert.equal(allowed.exception.lineNumberInExceptionFile, 3);
        assert.match(allowed.exception.line, /ERROR third/);
    } finally {
        await fs.remove(logDirectory);
    }
});
