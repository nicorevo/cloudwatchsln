const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    ProjectLogTail,
    TailError,
    normalizeTailLimit
} = require('../src/monitor/project-log-tail');

const FILE_PREFIX = 'sample-api-logs';

async function withLogDirectory(files, callback) {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-log-tail-'));

    try {
        for (const [filename, content] of Object.entries(files)) {
            await fs.writeFile(path.join(logDirectory, filename), content);
        }

        return await callback(logDirectory);
    } finally {
        await fs.remove(logDirectory);
    }
}

function logLine(timestamp, source, message) {
    return `[${timestamp}] [${source}] ${message}`;
}

test('initial tail restituisce le ultime righe dei soli file principali', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}_2026-06-23_10-00.log`]: [
            logLine('2026-06-23T08:00:00.000Z', 'group-a | api', 'first'),
            logLine('2026-06-23T08:00:01.000Z', 'group-a | api', 'second')
        ].join('\n') + '\n',
        [`${FILE_PREFIX}_2026-06-23_10-01.log`]: [
            '',
            logLine('2026-06-23T08:01:00.000Z', 'group-b | worker', 'ERROR failure'),
            logLine('2026-06-23T08:01:01.000Z', 'group-b | worker', 'last')
        ].join('\n') + '\n',
        [`${FILE_PREFIX}-exceptions_2026-06-23_10-01.log`]:
            logLine('2026-06-23T08:01:00.000Z', 'group-b | worker', 'ERROR failure'),
        'other-service_2026-06-23_10-01.log':
            logLine('2026-06-23T08:01:02.000Z', 'other', 'ignored')
    }, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: ['ERROR']
        });

        const result = await reader.read({ limit: 3 });

        assert.equal(result.reset, false);
        assert.equal(result.hasMore, false);
        assert.equal(result.lines.length, 3);
        assert.deepEqual(
            result.lines.map(line => line.message),
            ['second', 'ERROR failure', 'last']
        );
        assert.equal(result.lines[1].timestamp, '2026-06-23T08:01:00.000Z');
        assert.equal(result.lines[1].source, 'group-b | worker');
        assert.equal(result.lines[1].isException, true);
        assert.equal(result.lines[2].isException, false);
        assert.ok(result.cursor);
        assert.ok(result.lines.every(line => !line.raw.includes('other-service')));
    });
});

test('incremental tail legge append e rolling senza duplicare righe', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}_2026-06-23_10-00.log`]:
            logLine('2026-06-23T08:00:00.000Z', 'group | api', 'initial') + '\n'
    }, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: []
        });
        const initial = await reader.read({ limit: 20 });

        await fs.appendFile(
            path.join(logDirectory, `${FILE_PREFIX}_2026-06-23_10-00.log`),
            logLine('2026-06-23T08:00:01.000Z', 'group | api', 'appended') + '\n'
        );
        await fs.writeFile(
            path.join(logDirectory, `${FILE_PREFIX}_2026-06-23_10-01.log`),
            logLine('2026-06-23T08:01:00.000Z', 'group | worker', 'rolled') + '\n'
        );

        const next = await reader.read({
            limit: 20,
            after: initial.cursor
        });

        assert.deepEqual(next.lines.map(line => line.message), ['appended', 'rolled']);
        assert.equal(new Set(next.lines.map(line => line.id)).size, 2);

        const empty = await reader.read({
            limit: 20,
            after: next.cursor
        });
        assert.deepEqual(empty.lines, []);
        assert.equal(empty.cursor, next.cursor);
    });
});

test('incremental tail rispetta limit e segnala hasMore', async () => {
    const lines = Array.from({ length: 25 }, (_, index) =>
        logLine(
            `2026-06-23T08:00:${String(index).padStart(2, '0')}.000Z`,
            'group | api',
            `line-${index + 1}`
        )
    );

    await withLogDirectory({
        [`${FILE_PREFIX}_2026-06-23_10-00.log`]: lines.slice(0, 2).join('\n') + '\n'
    }, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: []
        });
        const initial = await reader.read({ limit: 20 });

        await fs.appendFile(
            path.join(logDirectory, `${FILE_PREFIX}_2026-06-23_10-00.log`),
            lines.slice(2).join('\n') + '\n'
        );

        const firstPage = await reader.read({ limit: 20, after: initial.cursor });
        assert.equal(firstPage.lines.length, 20);
        assert.equal(firstPage.hasMore, true);

        const secondPage = await reader.read({ limit: 20, after: firstPage.cursor });
        assert.equal(secondPage.lines.length, 3);
        assert.equal(secondPage.hasMore, false);
    });
});

test('cursore su file rimosso produce reset senza leggere file non correlati', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}_2026-06-23_10-00.log`]:
            logLine('2026-06-23T08:00:00.000Z', 'group | api', 'old') + '\n'
    }, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: []
        });
        const initial = await reader.read({ limit: 20 });

        await fs.remove(path.join(logDirectory, `${FILE_PREFIX}_2026-06-23_10-00.log`));
        await fs.writeFile(
            path.join(logDirectory, `${FILE_PREFIX}_2026-06-23_10-01.log`),
            logLine('2026-06-23T08:01:00.000Z', 'group | api', 'new baseline') + '\n'
        );

        const result = await reader.read({ limit: 20, after: initial.cursor });

        assert.equal(result.reset, true);
        assert.deepEqual(result.lines, []);
        assert.ok(result.cursor);
    });
});

test('riga non strutturata resta leggibile e pattern vuoti sono ignorati', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}_2026-06-23_10-00.log`]: 'plain ERROR line\n'
    }, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: ['', null, 'ERROR']
        });

        const result = await reader.read({ limit: 20 });

        assert.equal(result.lines[0].timestamp, null);
        assert.equal(result.lines[0].source, null);
        assert.equal(result.lines[0].message, 'plain ERROR line');
        assert.equal(result.lines[0].isException, true);
    });
});

test('rifiuta cursori malformati o riferiti a file fuori scope', async () => {
    await withLogDirectory({}, async logDirectory => {
        const reader = new ProjectLogTail({
            filePrefix: FILE_PREFIX,
            logDirectory,
            exceptionPatterns: []
        });

        await assert.rejects(
            () => reader.read({ limit: 20, after: 'not-base64-json' }),
            error => error instanceof TailError && error.code === 'INVALID_CURSOR'
        );

        const unsafeCursor = Buffer.from(JSON.stringify({
            v: 1,
            file: '../other.log',
            line: 0
        })).toString('base64url');

        await assert.rejects(
            () => reader.read({ limit: 20, after: unsafeCursor }),
            error => error instanceof TailError && error.code === 'INVALID_CURSOR'
        );
    });
});

test('normalizeTailLimit applica default e valida intervallo', () => {
    assert.equal(normalizeTailLimit(null), 200);
    assert.equal(normalizeTailLimit('20'), 20);
    assert.equal(normalizeTailLimit('1000'), 1000);

    for (const value of ['19', '1001', 'abc', '20x', '']) {
        assert.throws(
            () => normalizeTailLimit(value),
            error => error instanceof TailError && error.code === 'INVALID_LIMIT'
        );
    }
});
