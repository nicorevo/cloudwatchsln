const test = require('node:test');
const assert = require('node:assert/strict');

const ExceptionNotificationManager = require(
    '../src/notifications/exception-notification-manager'
);

function event(id, timestamp, stream, message, overrides = {}) {
    return {
        eventId: id,
        timestamp,
        ingestionTime: timestamp + 1,
        logGroupName: '/eks/example',
        logStreamName: stream,
        message,
        ...overrides
    };
}

function createHarness(overrides = {}) {
    const sent = [];
    const reservations = new Set();
    const completed = [];
    const timers = [];
    const stateStore = {
        async init() {},
        reserve(key) {
            if (reservations.has(key)) {
                return false;
            }
            reservations.add(key);
            return true;
        },
        async complete(key, status) {
            completed.push({ key, status });
        },
        async flush() {}
    };
    const channels = overrides.channels ?? [{
        id: 'slack-a',
        async send(notification) {
            sent.push(notification);
            return { status: 'sent', attempts: 1 };
        }
    }];
    const manager = new ExceptionNotificationManager({
        project: 'sample-api',
        environment: 'prod',
        filePrefix: 'sample-api-logs',
        logDirectory: '/tmp',
        monitorPatterns: [],
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: ['Known harmless'],
        channels: channels.map(channel => ({
            id: channel.id,
            type: 'slack',
            enabled: true,
            webhookUrlEnv: 'IGNORED',
            grouping: channel.grouping
        }))
    }, {
        info() {},
        warn() {},
        error() {}
    }, {
        channels,
        stateStore,
        setTimeout(callback, milliseconds) {
            const timer = { callback, milliseconds, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            timer.cleared = true;
        },
        now: () => Date.parse('2026-06-23T10:00:00.000Z')
    });

    return { manager, sent, completed, timers, stateStore };
}

function writeSummary(exceptionFileName = 'sample-api-logs-exceptions_2026-06-23_10-00.log') {
    return {
        logFileName: 'sample-api-logs_2026-06-23_10-00.log',
        exceptionFileName,
        writtenLineCount: 3,
        exceptionLineCount: exceptionFileName ? 3 : 0
    };
}

test('raccoglie 5 eventi strutturati prima e 5 dopo dallo stesso stream', async () => {
    const harness = createHarness();
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        ...Array.from({ length: 7 }, (_, index) =>
            event(`before-${index}`, base + index, 'stream-a', `before ${index}`)
        ),
        event('other', base + 20, 'stream-b', 'other stream'),
        event('exception', base + 21, 'stream-a', 'ERROR failure'),
        ...Array.from({ length: 5 }, (_, index) =>
            event(`after-${index}`, base + 30 + index, 'stream-a', `after ${index}`)
        )
    ]);
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
    assert.deepEqual(harness.sent[0].context.before, [
        { timestamp: base + 2, message: 'before 2' },
        { timestamp: base + 3, message: 'before 3' },
        { timestamp: base + 4, message: 'before 4' },
        { timestamp: base + 5, message: 'before 5' },
        { timestamp: base + 6, message: 'before 6' }
    ]);
    assert.equal(harness.sent[0].context.after.length, 5);
    assert.deepEqual(
        harness.sent[0].context.after.map(item => item.message),
        ['after 0', 'after 1', 'after 2', 'after 3', 'after 4']
    );
    assert.equal(harness.sent[0].context.timedOut, false);
    assert.equal(harness.sent[0].exception.message, 'ERROR failure');
    assert.equal(harness.sent[0].exception.line, undefined);
});

test('finalizza dopo 30 secondi con le righe successive disponibili', async () => {
    const harness = createHarness();
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('exception', base, 'stream-a', 'ERROR failure'),
        event('after', base + 1, 'stream-a', 'after one')
    ]);

    assert.equal(harness.sent.length, 0);
    assert.equal(harness.timers[0].milliseconds, 30000);
    await harness.timers[0].callback();
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].context.after.length, 1);
    assert.equal(harness.sent[0].context.timedOut, true);
});

test('gestisce eccezioni sovrapposte come notifiche distinte', async () => {
    const harness = createHarness();
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('exception-a', base, 'stream-a', 'ERROR first'),
        event('exception-b', base + 1, 'stream-a', 'ERROR second'),
        ...Array.from({ length: 5 }, (_, index) =>
            event(`after-${index}`, base + 10 + index, 'stream-a', `after ${index}`)
        )
    ]);
    for (const timer of harness.timers.filter(timer => !timer.cleared)) {
        await timer.callback();
    }
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 2);
    assert.match(harness.sent[0].exception.message, /ERROR first/);
    assert.match(harness.sent[1].exception.message, /ERROR second/);
});

test('applica monitorPatterns ed excludeExceptionPatterns', async () => {
    const harness = createHarness();
    harness.manager.monitorPatterns = ['KEEP'];
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('ignored', base, 'stream-a', 'ERROR without marker'),
        event('excluded', base + 1, 'stream-a', 'KEEP ERROR Known harmless'),
        event('real', base + 2, 'stream-a', 'KEEP ERROR real')
    ]);
    await harness.timers[0].callback();
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
    assert.match(harness.sent[0].exception.message, /KEEP ERROR real/);
    assert.equal(harness.sent[0].context.before.length, 1);
    assert.equal(
        harness.sent[0].context.before[0].message,
        'KEEP ERROR Known harmless'
    );
});

test('estrae soltanto il campo log dai payload JSON Kubernetes', async () => {
    const harness = createHarness();
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('before', base, 'stream-a', JSON.stringify({
            log: 'before normalized\n',
            kubernetes: { container_name: 'api' }
        })),
        event('exception', base + 1, 'stream-a', JSON.stringify({
            log: 'ERROR normalized exception\n',
            kubernetes: { container_name: 'api' }
        }))
    ]);
    await harness.timers[0].callback();
    await harness.manager.waitForIdle();

    assert.deepEqual(harness.sent[0].context.before, [{
        timestamp: base,
        message: 'before normalized'
    }]);
    assert.equal(
        harness.sent[0].exception.message,
        'ERROR normalized exception'
    );
});

test('esegue fan-out e persiste un esito per ogni channel', async () => {
    const sentBy = [];
    const channels = ['slack-a', 'slack-b'].map(id => ({
        id,
        async send() {
            sentBy.push(id);
            return { status: id === 'slack-a' ? 'sent' : 'failed', attempts: 1 };
        }
    }));
    const harness = createHarness({ channels });
    await harness.manager.init();

    harness.manager.ingest([
        event('exception', Date.now(), 'stream-a', 'ERROR failure')
    ]);
    await harness.timers[0].callback();
    await harness.manager.waitForIdle();

    assert.deepEqual(sentBy.sort(), ['slack-a', 'slack-b']);
    assert.deepEqual(
        harness.completed.map(entry => entry.status).sort(),
        ['failed', 'sent']
    );
});

test('raggruppa eccezioni dello stesso file in un digest per channel', async () => {
    const harness = createHarness({
        channels: [{
            id: 'grouped-slack',
            grouping: { mode: 'exception-file', flushDelaySeconds: 70 },
            async send(notification) {
                harness.sent.push(notification);
                return { status: 'sent', attempts: 1 };
            }
        }]
    });
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('exception-a', base, 'stream-a', 'ERROR first'),
        event('exception-b', base + 1, 'stream-b', 'ERROR second'),
        event('exception-c', base + 2, 'stream-c', 'ERROR third')
    ], writeSummary());

    assert.equal(harness.sent.length, 0);
    const digestTimer = harness.timers.find(timer => timer.milliseconds === 70000);
    assert.ok(digestTimer);
    await digestTimer.callback();
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].type, 'exception-file-digest');
    assert.equal(harness.sent[0].exceptionFileName, 'sample-api-logs-exceptions_2026-06-23_10-00.log');
    assert.equal(harness.sent[0].exceptionCount, 3);
    assert.equal(harness.completed.length, 3);
    assert.deepEqual(
        [...new Set(harness.completed.map(entry => entry.status))],
        ['sent']
    );
});

test('raggruppa file eccezioni distinti in digest distinti', async () => {
    const harness = createHarness({
        channels: [{
            id: 'grouped-slack',
            grouping: { mode: 'exception-file', flushDelaySeconds: 70 },
            async send(notification) {
                harness.sent.push(notification);
                return { status: 'sent', attempts: 1 };
            }
        }]
    });
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');

    harness.manager.ingest([
        event('exception-a', base, 'stream-a', 'ERROR first')
    ], writeSummary('sample-api-logs-exceptions_2026-06-23_10-00.log'));
    harness.manager.ingest([
        event('exception-b', base + 1, 'stream-a', 'ERROR second')
    ], writeSummary('sample-api-logs-exceptions_2026-06-23_10-01.log'));

    for (const timer of harness.timers.filter(timer => !timer.cleared)) {
        await timer.callback();
    }
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 2);
    assert.deepEqual(
        harness.sent.map(notification => notification.exceptionFileName).sort(),
        [
            'sample-api-logs-exceptions_2026-06-23_10-00.log',
            'sample-api-logs-exceptions_2026-06-23_10-01.log'
        ]
    );
});

test('digest non conta eventi duplicati e viene flushato in shutdown', async () => {
    const harness = createHarness({
        channels: [{
            id: 'grouped-slack',
            grouping: { mode: 'exception-file', flushDelaySeconds: 70 },
            async send(notification) {
                harness.sent.push(notification);
                return { status: 'sent', attempts: 1 };
            }
        }]
    });
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');
    const duplicate = event('same-event', base, 'stream-a', 'ERROR duplicated');

    harness.manager.ingest([
        duplicate,
        { ...duplicate }
    ], writeSummary());

    await harness.manager.close({ timeoutMs: 100 });
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].exceptionCount, 1);
    assert.equal(harness.completed.length, 1);
});

test('ignora eventi CloudWatch duplicati nel buffer e nel contesto', async () => {
    const harness = createHarness();
    await harness.manager.init();
    const base = Date.parse('2026-06-23T10:00:00.000Z');
    const duplicate = event('same-event', base, 'stream-a', 'before duplicate');

    harness.manager.ingest([
        duplicate,
        { ...duplicate },
        event('exception', base + 1, 'stream-a', 'ERROR failure'),
        event('after', base + 2, 'stream-a', 'after one'),
        event('after', base + 2, 'stream-a', 'after one')
    ]);
    await harness.timers[0].callback();
    await harness.manager.waitForIdle();

    assert.equal(harness.sent[0].context.before.length, 1);
    assert.equal(harness.sent[0].context.after.length, 1);
});

test('shutdown finalizza le pending e rifiuta nuovi eventi', async () => {
    const harness = createHarness();
    await harness.manager.init();
    harness.manager.ingest([
        event('exception', Date.now(), 'stream-a', 'ERROR failure')
    ]);

    await harness.manager.close({ timeoutMs: 100 });
    harness.manager.ingest([
        event('new-exception', Date.now() + 1, 'stream-a', 'ERROR new')
    ]);
    await harness.manager.waitForIdle();

    assert.equal(harness.sent.length, 1);
});

test('shutdown rispetta il timeout anche con una consegna bloccata', async () => {
    const harness = createHarness({
        channels: [{
            id: 'blocked-slack',
            async send() {
                return new Promise(() => {});
            }
        }]
    });
    await harness.manager.init();
    harness.manager.ingest([
        event('exception', Date.now(), 'stream-a', 'ERROR failure')
    ]);

    const closing = harness.manager.close({ timeoutMs: 100 });
    await Promise.resolve();
    const shutdownTimer = harness.timers.find(timer => timer.milliseconds === 100);
    assert.ok(shutdownTimer);
    await shutdownTimer.callback();
    await closing;
});
