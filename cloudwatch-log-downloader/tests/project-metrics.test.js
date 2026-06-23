const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ProjectMetrics = require('../src/monitor/project-metrics');

const FILE_PREFIX = 'sample-service-logs';
const NOW = new Date('2026-06-22T12:00:00.000Z');

async function withLogDirectory(files, callback) {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-metrics-'));

    try {
        for (const [filename, content] of Object.entries(files)) {
            await fs.writeFile(path.join(logDirectory, filename), content);
        }

        return await callback(logDirectory);
    } finally {
        await fs.remove(logDirectory);
    }
}

function exceptionLine(timestamp, message) {
    return `[${timestamp}] [/eks/example | container] ${message}`;
}

test('calcola totale, file non vuoti e ultima eccezione dai file conservati', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_a.log`]: [
            exceptionLine('2026-06-22T09:00:00.000Z', 'ERROR first'),
            '',
            exceptionLine('2026-06-22T11:30:00.000Z', 'ERROR latest')
        ].join('\n'),
        [`${FILE_PREFIX}-exceptions_b.log`]: '   \n',
        [`${FILE_PREFIX}_a.log`]: exceptionLine('2026-06-22T11:30:00.000Z', 'ERROR latest'),
        'other-service-exceptions_a.log': exceptionLine('2026-06-22T11:45:00.000Z', 'ERROR ignored')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({ now: NOW });

        assert.equal(result.retainedExceptionCount, 2);
        assert.equal(result.exceptionFileCount, 1);
        assert.equal(result.latestExceptionAt, '2026-06-22T11:30:00.000Z');
    });
});

test('restituisce metriche vuote quando non esistono file eccezione', async () => {
    await withLogDirectory({}, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({ now: NOW });

        assert.deepEqual(result, {
            retainedExceptionCount: 0,
            lastHourExceptionCount: 0,
            todayExceptionCount: 0,
            exceptionFileCount: 0,
            latestExceptionAt: null
        });
    });
});

test('calcola ultima ora includendo il confine e ignorando timestamp futuri', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_window.log`]: [
            exceptionLine('2026-06-22T10:59:59.999Z', 'ERROR before window'),
            exceptionLine('2026-06-22T11:00:00.000Z', 'ERROR boundary'),
            exceptionLine('2026-06-22T11:59:59.999Z', 'ERROR recent'),
            exceptionLine('2026-06-22T12:00:00.000Z', 'ERROR now'),
            exceptionLine('2026-06-22T12:00:00.001Z', 'ERROR future')
        ].join('\n')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({ now: NOW });

        assert.equal(result.retainedExceptionCount, 5);
        assert.equal(result.lastHourExceptionCount, 3);
        assert.equal(result.latestExceptionAt, '2026-06-22T12:00:00.001Z');
    });
});

test('calcola oggi nel fuso Europe/Rome anche vicino alla mezzanotte', async () => {
    const now = new Date('2026-06-21T22:30:00.000Z');

    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_day.log`]: [
            exceptionLine('2026-06-21T21:59:59.999Z', 'ERROR yesterday in Rome'),
            exceptionLine('2026-06-21T22:00:00.000Z', 'ERROR today in Rome'),
            exceptionLine('2026-06-22T10:00:00.000Z', 'ERROR future same Rome day')
        ].join('\n')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({
            now,
            timezone: 'Europe/Rome'
        });

        assert.equal(result.todayExceptionCount, 2);
    });
});

test('gestisce il cambio DST Europe/Rome confrontando il giorno locale', async () => {
    const now = new Date('2026-03-29T22:30:00.000Z');

    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_dst.log`]: [
            exceptionLine('2026-03-29T21:59:59.999Z', 'ERROR previous local day'),
            exceptionLine('2026-03-29T22:00:00.000Z', 'ERROR current local day')
        ].join('\n')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({
            now,
            timezone: 'Europe/Rome'
        });

        assert.equal(result.todayExceptionCount, 1);
    });
});

test('timestamp assenti o invalidi contribuiscono solo al totale', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_invalid.log`]: [
            'ERROR without structured timestamp',
            exceptionLine('not-a-date', 'ERROR invalid timestamp')
        ].join('\n')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory);
        const result = await metrics.calculate({ now: NOW });

        assert.equal(result.retainedExceptionCount, 2);
        assert.equal(result.lastHourExceptionCount, 0);
        assert.equal(result.todayExceptionCount, 0);
        assert.equal(result.latestExceptionAt, null);
    });
});

test('ignora righe escluse in tutti i conteggi e nei file visibili', async () => {
    await withLogDirectory({
        [`${FILE_PREFIX}-exceptions_filtered.log`]: [
            exceptionLine('2026-06-22T11:30:00.000Z', 'ERROR real failure'),
            exceptionLine('2026-06-22T11:45:00.000Z', 'ERROR Known harmless error')
        ].join('\n'),
        [`${FILE_PREFIX}-exceptions_only-excluded.log`]:
            exceptionLine('2026-06-22T11:50:00.000Z', 'ERROR Known harmless error')
    }, async logDirectory => {
        const metrics = new ProjectMetrics(FILE_PREFIX, logDirectory, {
            exceptionPatterns: ['ERROR'],
            excludeExceptionPatterns: ['Known harmless error']
        });
        const result = await metrics.calculate({ now: NOW });

        assert.deepEqual(result, {
            retainedExceptionCount: 1,
            lastHourExceptionCount: 1,
            todayExceptionCount: 1,
            exceptionFileCount: 1,
            latestExceptionAt: '2026-06-22T11:30:00.000Z'
        });
    });
});
