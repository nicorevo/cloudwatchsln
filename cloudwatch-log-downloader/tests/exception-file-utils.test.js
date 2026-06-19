const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getPairedMainFilename,
    parseExceptionId,
    buildExceptionId,
    buildPreview,
    findLineInMain,
    parseExceptionFilename,
    parseLogLine,
    parseLogFileTimestamp,
    isValidFileId,
    resolveSafeLogPath
} = require('../src/monitor/exception-file-utils');
const path = require('path');

const FILE_PREFIX = 'my-app-logs-prod';

test('getPairedMainFilename maps exception file to main file', () => {
    const exceptionFilename = 'my-app-logs-prod-exceptions_2026-06-19_11-49.log';
    assert.equal(
        getPairedMainFilename(exceptionFilename, FILE_PREFIX),
        'my-app-logs-prod_2026-06-19_11-49.log'
    );
});

test('parseExceptionFilename extracts timestamp id', () => {
    const parsed = parseExceptionFilename(
        FILE_PREFIX,
        'my-app-logs-prod-exceptions_fixture.log'
    );

    assert.deepEqual(parsed, {
        type: 'exception',
        timestamp: 'fixture',
        id: 'fixture'
    });
});

test('parseExceptionId parses stable exception id', () => {
    assert.deepEqual(parseExceptionId('2026-06-19_11-49:2'), {
        fileId: '2026-06-19_11-49',
        indexInFile: 2
    });
    assert.equal(parseExceptionId('invalid'), null);
});

test('buildExceptionId composes id', () => {
    assert.equal(buildExceptionId('fixture', 2), 'fixture:2');
});

test('buildPreview truncates long text', () => {
    const preview = buildPreview('x'.repeat(150), 120);
    assert.equal(preview.length, 120);
    assert.match(preview, /\.\.\.$/);
});

test('findLineInMain returns first matching line index', () => {
    const lines = [
        'alpha',
        'beta',
        'gamma',
        'beta'
    ];

    assert.equal(findLineInMain(lines, 'beta'), 1);
    assert.equal(findLineInMain(lines, 'missing'), -1);
});

test('parseLogLine extracts timestamp source and preview', () => {
    const line = '[2026-06-19T09:00:05.000Z] [/eks/test | worker] ERROR something failed';
    const parsed = parseLogLine(line);

    assert.equal(parsed.timestamp, '2026-06-19T09:00:05.000Z');
    assert.equal(parsed.source, '/eks/test | worker');
    assert.equal(parsed.body, 'ERROR something failed');
    assert.equal(parsed.preview, 'ERROR something failed');
});

test('isValidFileId rejects path traversal segments', () => {
    assert.equal(isValidFileId('2026-06-19_11-49'), true);
    assert.equal(isValidFileId('fixture'), true);
    assert.equal(isValidFileId('../../../etc/passwd'), false);
    assert.equal(isValidFileId('foo/bar'), false);
});

test('parseExceptionId rejects unsafe file ids', () => {
    assert.equal(parseExceptionId('../../../etc/passwd:1'), null);
});

test('resolveSafeLogPath blocks traversal filenames', () => {
    const logDir = path.resolve('/tmp/logs');
    const unsafe = resolveSafeLogPath(logDir, 'my-app-logs-prod-exceptions_../../../etc/passwd.log');
    assert.equal(unsafe, null);
});

test('parseLogFileTimestamp supports main and exception files', () => {
    assert.deepEqual(
        parseLogFileTimestamp(FILE_PREFIX, 'my-app-logs-prod-exceptions_fixture.log'),
        { type: 'exception', timestamp: 'fixture', id: 'fixture' }
    );
    assert.deepEqual(
        parseLogFileTimestamp(FILE_PREFIX, 'my-app-logs-prod_fixture.log'),
        { type: 'main', timestamp: 'fixture', id: 'fixture' }
    );
});
