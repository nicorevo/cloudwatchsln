const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ExceptionContext = require('../src/monitor/exception-context');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const MONITOR_CONFIG = {
    contextLinesBefore: 10,
    contextLinesAfter: 10
};

test('resolveExceptionContext returns context around second exception', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR);
    const result = await contextService.resolveExceptionContext('fixture:2');

    assert.equal(result.exception.lineNumberInMain, 15);
    assert.equal(result.context.before.length, 10);
    assert.equal(result.context.after.length, 5);
    assert.equal(result.context.before[0].lineNumber, 5);
    assert.equal(result.context.after[result.context.after.length - 1].lineNumber, 20);
});

test('resolveExceptionContext uses first duplicate match in main file', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR);
    const result = await contextService.resolveExceptionContext('fixture:1');

    assert.equal(result.exception.lineNumberInMain, 5);
});

test('resolveExceptionContext warns when main file is missing', async () => {
    const contextService = new ExceptionContext(
        MONITOR_CONFIG,
        FILE_PREFIX,
        FIXTURE_DIR
    );

    const result = await contextService.resolveExceptionContext('orphan:1');

    assert.equal(result.warning, 'main_file_missing');
    assert.deepEqual(result.context.before, []);
    assert.deepEqual(result.context.after, []);
});

test('resolveExceptionContext rejects invalid id', async () => {
    const contextService = new ExceptionContext(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR);

    await assert.rejects(
        () => contextService.resolveExceptionContext('invalid-id'),
        error => error.code === 'INVALID_ID'
    );
});

test('resolveExceptionContext rejects missing exception file prefix', async () => {
    const contextService = new ExceptionContext(
        MONITOR_CONFIG,
        'missing-prefix',
        FIXTURE_DIR
    );

    await assert.rejects(
        () => contextService.resolveExceptionContext('fixture:1'),
        error => error.code === 'NOT_FOUND'
    );
});
