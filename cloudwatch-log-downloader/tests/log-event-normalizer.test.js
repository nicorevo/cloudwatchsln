const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeLogEvent,
    formatNormalizedLogLine
} = require('../src/log-event-normalizer');

test('normalizeLogEvent estrae body e container dai payload JSON Kubernetes', () => {
    const normalized = normalizeLogEvent({
        eventId: 'event-1',
        timestamp: Date.parse('2026-06-23T08:00:00.000Z'),
        ingestionTime: Date.parse('2026-06-23T08:00:01.000Z'),
        logGroupName: '/eks/example',
        logStreamName: 'pod/api',
        message: JSON.stringify({
            log: 'ERROR database unavailable\n',
            kubernetes: { container_name: 'api' }
        })
    });

    assert.deepEqual(normalized, {
        eventId: 'event-1',
        timestamp: Date.parse('2026-06-23T08:00:00.000Z'),
        ingestionTime: Date.parse('2026-06-23T08:00:01.000Z'),
        logGroupName: '/eks/example',
        logStreamName: 'pod/api',
        containerName: 'api',
        body: 'ERROR database unavailable'
    });
    assert.equal(
        formatNormalizedLogLine(normalized),
        '[2026-06-23T08:00:00.000Z] [/eks/example | api] ERROR database unavailable'
    );
});

test('normalizeLogEvent conserva messaggi testuali e fallback di sorgente', () => {
    const normalized = normalizeLogEvent({
        timestamp: Date.parse('2026-06-23T08:00:00.000Z'),
        message: 'plain message'
    });

    assert.equal(normalized.body, 'plain message');
    assert.equal(normalized.logGroupName, 'unknown');
    assert.equal(normalized.logStreamName, 'unknown');
    assert.equal(
        formatNormalizedLogLine(normalized),
        '[2026-06-23T08:00:00.000Z] [unknown] plain message'
    );
});
