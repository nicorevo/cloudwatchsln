const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SlackChannel,
    formatSlackMessage,
    MAX_SLACK_TEXT_LENGTH
} = require('../src/notifications/slack-channel');

function notification(overrides = {}) {
    return {
        notificationId: 'notification-1',
        project: 'sample-api',
        environment: 'prod',
        detectedAt: '2026-06-23T10:15:12.000Z',
        exception: {
            eventId: 'event-1',
            timestamp: '2026-06-23T10:15:10.250Z',
            logGroupName: '/eks/example/sample-api',
            logStreamName: 'pod/sample-api-abc',
            message: 'ERROR database unavailable'
        },
        context: {
            before: [{
                timestamp: Date.parse('2026-06-23T10:15:09.100Z'),
                message: 'request started'
            }],
            after: [{
                timestamp: Date.parse('2026-06-23T10:15:11.100Z'),
                message: 'retry planned'
            }],
            timedOut: false
        },
        ...overrides
    };
}

function createLogger() {
    const calls = [];
    return {
        calls,
        info(message, data) { calls.push({ level: 'info', message, data }); },
        warn(message, data) { calls.push({ level: 'warn', message, data }); },
        error(message, data) { calls.push({ level: 'error', message, data }); }
    };
}

test('formatSlackMessage include intestazione e righe compatte UTC', () => {
    const text = formatSlackMessage(notification({
        exception: {
            eventId: 'event-1',
            timestamp: '2026-06-23T10:15:10.250Z',
            logGroupName: '<https://evil.example|click>',
            logStreamName: 'pod/api',
            message: 'ERROR ``` <!channel> & failure\nsecond line'
        }
    }));

    assert.match(text, /^Progetto: sample-api\nAmbiente: prod\n/);
    assert.match(text, /Timestamp: 2026-06-23T10:15:10.250Z/);
    assert.match(text, /Log group: &lt;https:\/\/evil\.example\|click&gt;/);
    assert.match(text, /Log stream: pod\/api/);
    assert.match(text, /10:15:09 request started/);
    assert.match(
        text,
        /\*10:15:10 \[ECCEZIONE\] ERROR ''' &lt;!channel&gt; &amp; failure ↵ second line\*/
    );
    assert.match(text, /10:15:11 retry planned/);
    assert.doesNotMatch(text, /Contesto:|\[prima\]|\[dopo\]|rotating_light/);
    assert.doesNotMatch(text, /```/);
    assert.doesNotMatch(text, /<!channel>/);
    assert.doesNotMatch(text, /failure\nsecond/);
});

test('formatSlackMessage elimina righe intere lontane senza troncare quelle incluse', () => {
    const longLine = 'x'.repeat(900);
    const text = formatSlackMessage(notification({
        exception: {
            ...notification().exception,
            message: `ERROR-${'e'.repeat(1000)}`
        },
        context: {
            before: Array.from({ length: 5 }, (_, index) => ({
                timestamp: Date.parse(`2026-06-23T10:15:0${index}.000Z`),
                message: `before-${index}-${longLine}`
            })),
            after: Array.from({ length: 5 }, (_, index) => ({
                timestamp: Date.parse(`2026-06-23T10:15:1${index + 1}.000Z`),
                message: `after-${index}-${longLine}`
            })),
            timedOut: true
        }
    }));

    assert.ok(text.length <= MAX_SLACK_TEXT_LENGTH);
    assert.match(text, /ERROR-e{1000}/);
    assert.doesNotMatch(text, /troncata/);
    assert.match(text, /before-4-/);
    assert.match(text, /after-0-/);
    assert.doesNotMatch(text, /before-0-/);
    assert.doesNotMatch(text, /after-4-/);
});

test('formatSlackMessage non elimina contesto utile per mostrare il conteggio omesso', () => {
    const minimalNotification = notification({
        exception: {
            ...notification().exception,
            message: 'ERROR'
        },
        context: { before: [], after: [], timedOut: false }
    });
    const minimalLength = formatSlackMessage(minimalNotification).length;
    const nearLineLength = '10:15:09 near'.length + 1;
    const paddingLength = MAX_SLACK_TEXT_LENGTH
        - minimalLength
        - nearLineLength
        - 4;

    const text = formatSlackMessage(notification({
        exception: {
            ...notification().exception,
            message: `ERROR${'x'.repeat(paddingLength)}`
        },
        context: {
            before: [
                {
                    timestamp: Date.parse('2026-06-23T10:15:08.000Z'),
                    message: 'far'.repeat(2000)
                },
                {
                    timestamp: Date.parse('2026-06-23T10:15:09.000Z'),
                    message: 'near'
                }
            ],
            after: [],
            timedOut: false
        }
    }));

    assert.match(text, /10:15:09 near/);
    assert.doesNotMatch(text, /Righe di contesto omesse/);
});

test('SlackChannel fallisce senza HTTP se intestazione ed eccezione superano il limite', async () => {
    let requests = 0;
    const logger = createLogger();
    const channel = new SlackChannel({
        id: 'operations-slack',
        webhookUrlEnv: 'IGNORED'
    }, logger, {
        webhookUrl: 'https://hooks.slack.com/services/test',
        request: async () => {
            requests++;
            return { statusCode: 200, body: 'ok', headers: {} };
        },
        sleep: async () => {}
    });

    const result = await channel.send(notification({
        exception: {
            ...notification().exception,
            message: `ERROR-${'x'.repeat(MAX_SLACK_TEXT_LENGTH)}`
        },
        context: { before: [], after: [], timedOut: false }
    }));

    assert.deepEqual(result, { status: 'failed', attempts: 0 });
    assert.equal(requests, 0);
    assert.ok(logger.calls.some(call =>
        call.level === 'error'
        && call.message.includes('troppo lunga')
    ));
});

test('SlackChannel considera successo soltanto HTTP 200 con body ok', async () => {
    const calls = [];
    const logger = createLogger();
    const channel = new SlackChannel({
        id: 'operations-slack',
        webhookUrlEnv: 'IGNORED'
    }, logger, {
        webhookUrl: 'https://hooks.slack.com/services/test',
        request: async (url, payload) => {
            calls.push({ url, payload });
            return { statusCode: 200, body: 'ok', headers: {} };
        },
        sleep: async () => {}
    });

    const result = await channel.send(notification());

    assert.deepEqual(result, { status: 'sent', attempts: 1 });
    assert.equal(calls[0].payload.unfurl_links, false);
    assert.equal(calls[0].payload.unfurl_media, false);
    assert.equal(calls[0].payload.mrkdwn, true);
    assert.doesNotMatch(JSON.stringify(logger.calls), /hooks\.slack\.com/);
});

test('SlackChannel ritenta errori transitori con attese crescenti', async () => {
    const responses = [
        { statusCode: 500, body: 'server_error', headers: {} },
        { statusCode: 429, body: 'rate_limited', headers: { 'retry-after': '2' } },
        { statusCode: 200, body: 'ok', headers: {} }
    ];
    const waits = [];
    const channel = new SlackChannel({
        id: 'operations-slack',
        webhookUrlEnv: 'IGNORED'
    }, createLogger(), {
        webhookUrl: 'https://hooks.slack.com/services/test',
        request: async () => responses.shift(),
        sleep: async milliseconds => { waits.push(milliseconds); }
    });

    const result = await channel.send(notification());

    assert.deepEqual(result, { status: 'sent', attempts: 3 });
    assert.deepEqual(waits, [1000, 2000]);
});

test('SlackChannel non ritenta errori permanenti', async () => {
    let requests = 0;
    const channel = new SlackChannel({
        id: 'operations-slack',
        webhookUrlEnv: 'IGNORED'
    }, createLogger(), {
        webhookUrl: 'https://hooks.slack.com/services/test',
        request: async () => {
            requests++;
            return { statusCode: 403, body: 'action_prohibited', headers: {} };
        },
        sleep: async () => {}
    });

    const result = await channel.send(notification());

    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 1);
    assert.equal(requests, 1);
});

test('SlackChannel tenta al massimo tre volte per errori di rete', async () => {
    let requests = 0;
    const channel = new SlackChannel({
        id: 'operations-slack',
        webhookUrlEnv: 'IGNORED'
    }, createLogger(), {
        webhookUrl: 'https://hooks.slack.com/services/test',
        request: async () => {
            requests++;
            const error = new Error('socket closed');
            error.code = 'ECONNRESET';
            throw error;
        },
        sleep: async () => {}
    });

    const result = await channel.send(notification());

    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 3);
    assert.equal(requests, 3);
});
