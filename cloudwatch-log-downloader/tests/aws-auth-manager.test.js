const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const {
    AwsAuthManager,
    buildSsoExpiredError,
    getSsoSessionExpiry,
    isTokenError,
    parseIniSections,
    resolveProfileStartUrl,
    readSsoCacheEntries
} = require('../src/aws-auth-manager');

const logger = {
    info() {},
    warn() {},
    error() {}
};

const awsConfig = {
    region: 'eu-central-1',
    profile: 'test-profile',
    credentialRefreshIntervalMinutes: 55,
    loginOnStartupIfNeeded: false,
    ssoSessionWarningMinutes: 30
};

test('parseIniSections reads profile and sso-session blocks', () => {
    const content = [
        '[profile test-profile]',
        'sso_session = test-session',
        'sso_account_id = 123',
        '',
        '[sso-session test-session]',
        'sso_start_url = https://example.awsapps.com/start',
        'sso_region = eu-central-1'
    ].join('\n');

    const sections = parseIniSections(content);
    assert.equal(resolveProfileStartUrl(sections, 'test-profile'), 'https://example.awsapps.com/start');
});

test('getSsoSessionExpiry returns latest matching cache entry', async () => {
    const fixturesDir = path.join(__dirname, 'fixtures', 'aws');
    const expiry = await getSsoSessionExpiry('test-profile', {
        homeDirectory: fixturesDir,
        awsConfigPath: path.join(fixturesDir, '.aws', 'config'),
        ssoCacheDirectory: path.join(fixturesDir, '.aws', 'sso', 'cache')
    });

    assert.ok(expiry);
    assert.equal(expiry.toISOString(), '2026-06-20T18:00:00.000Z');
});

test('authenticate resolves credentials and identity', async () => {
    const expiration = new Date('2026-06-19T14:00:00.000Z');
    let providerCalls = 0;

    const authManager = new AwsAuthManager(awsConfig, logger, {
        createCredentialProvider: () => async () => {
            providerCalls += 1;
            return {
                accessKeyId: 'TEST',
                secretAccessKey: 'TEST',
                sessionToken: 'TEST',
                expiration
            };
        },
        verifyIdentity: async () => ({
            Account: '123456789012',
            Arn: 'arn:aws:sts::123456789012:assumed-role/Test'
        }),
        getSsoSessionExpiry: async () => new Date('2026-06-20T18:00:00.000Z')
    });

    const result = await authManager.authenticate();

    assert.equal(providerCalls, 1);
    assert.equal(result.account, '123456789012');
    assert.equal(result.credentialExpiration.toISOString(), expiration.toISOString());
    assert.equal(authManager.isAuthenticated(), true);
});

test('authenticate throws actionable error when SSO token expired', async () => {
    const authManager = new AwsAuthManager(awsConfig, logger, {
        createCredentialProvider: () => async () => {
            const error = new Error('Token refresh required');
            error.name = 'TokenRefreshRequired';
            throw error;
        }
    });

    await assert.rejects(
        () => authManager.authenticate(),
        error => error.message.includes('aws sso login --profile test-profile')
    );
});

test('refreshCredentials invokes provider again', async () => {
    let providerCalls = 0;
    const authManager = new AwsAuthManager(awsConfig, logger, {
        createCredentialProvider: () => async () => {
            providerCalls += 1;
            return {
                accessKeyId: 'TEST',
                secretAccessKey: 'TEST',
                sessionToken: 'TEST',
                expiration: new Date('2026-06-19T15:00:00.000Z')
            };
        },
        verifyIdentity: async () => ({ Account: '123', Arn: 'arn:test' }),
        getSsoSessionExpiry: async () => null
    });

    await authManager.authenticate();
    await authManager.refreshCredentials();

    assert.equal(providerCalls, 2);
});

test('refreshCredentials marks auth invalid on token error', async () => {
    let shouldFail = false;
    const authManager = new AwsAuthManager(awsConfig, logger, {
        createCredentialProvider: () => async () => {
            if (shouldFail) {
                throw buildSsoExpiredError(awsConfig.profile);
            }

            return {
                accessKeyId: 'TEST',
                secretAccessKey: 'TEST',
                sessionToken: 'TEST',
                expiration: new Date('2026-06-19T15:00:00.000Z')
            };
        },
        verifyIdentity: async () => ({ Account: '123', Arn: 'arn:test' }),
        getSsoSessionExpiry: async () => null
    });

    await authManager.authenticate();
    shouldFail = true;

    await assert.rejects(() => authManager.refreshCredentials());
    assert.equal(authManager.isAuthenticated(), false);
});

test('isTokenError detects common AWS credential failures', () => {
    assert.equal(isTokenError({ name: 'TokenRefreshRequired', message: 'x' }), true);
    assert.equal(isTokenError(new Error('The SSO session associated with this profile has expired')), true);
    assert.equal(isTokenError(new Error('network down')), false);
});

test('readSsoCacheEntries ignores invalid json files', async () => {
    const fixturesDir = path.join(__dirname, 'fixtures', 'aws');
    const entries = await readSsoCacheEntries(path.join(fixturesDir, '.aws', 'sso', 'cache'));

    assert.equal(entries.length, 1);
    assert.equal(entries[0].startUrl, 'https://example.awsapps.com/start');
});
