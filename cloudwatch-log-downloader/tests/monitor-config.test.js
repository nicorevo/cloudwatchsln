const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMonitorConfig, DEFAULT_MONITOR_CONFIG } = require('../src/monitor/monitor-config');

test('normalizeMonitorConfig applies defaults when monitor section is missing', () => {
    const normalized = normalizeMonitorConfig({});

    assert.deepEqual(normalized, DEFAULT_MONITOR_CONFIG);
});

test('normalizeMonitorConfig preserves explicit overrides', () => {
    const normalized = normalizeMonitorConfig({
        monitor: {
            enabled: false,
            port: 4000,
            contextLinesBefore: 5
        }
    });

    assert.equal(normalized.enabled, false);
    assert.equal(normalized.port, 4000);
    assert.equal(normalized.contextLinesBefore, 5);
    assert.equal(normalized.host, DEFAULT_MONITOR_CONFIG.host);
});

test('normalizeMonitorConfig preserves zero values when explicit', () => {
    const normalized = normalizeMonitorConfig({
        monitor: {
            port: 0,
            contextLinesBefore: 0,
            contextLinesAfter: 0
        }
    });

    assert.equal(normalized.port, 0);
    assert.equal(normalized.contextLinesBefore, 0);
    assert.equal(normalized.contextLinesAfter, 0);
});
