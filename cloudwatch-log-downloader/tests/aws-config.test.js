const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAwsConfig, DEFAULT_AWS_CONFIG } = require('../src/aws-config');

test('normalizeAwsConfig applies defaults when aws section is partial', () => {
    const normalized = normalizeAwsConfig({
        aws: {
            region: 'eu-central-1',
            profile: 'test-profile'
        }
    });

    assert.equal(normalized.credentialRefreshIntervalMinutes, DEFAULT_AWS_CONFIG.credentialRefreshIntervalMinutes);
    assert.equal(normalized.loginOnStartupIfNeeded, false);
    assert.equal(normalized.ssoSessionWarningMinutes, DEFAULT_AWS_CONFIG.ssoSessionWarningMinutes);
});

test('normalizeAwsConfig keeps zero interval out by falling back to default', () => {
    const normalized = normalizeAwsConfig({
        aws: {
            region: 'eu-central-1',
            profile: 'test-profile',
            credentialRefreshIntervalMinutes: 0
        }
    });

    assert.equal(normalized.credentialRefreshIntervalMinutes, 55);
});

test('normalizeAwsConfig preserves explicit refresh interval', () => {
    const normalized = normalizeAwsConfig({
        aws: {
            region: 'eu-central-1',
            profile: 'test-profile',
            credentialRefreshIntervalMinutes: 60,
            loginOnStartupIfNeeded: true
        }
    });

    assert.equal(normalized.credentialRefreshIntervalMinutes, 60);
    assert.equal(normalized.loginOnStartupIfNeeded, true);
});
