const test = require('node:test');
const assert = require('node:assert/strict');

const CloudWatchClient = require('../src/cloudwatch-client');

function createLogger() {
    const calls = [];
    return {
        calls,
        info(message, data) {
            calls.push({ level: 'info', message, data });
        },
        warn(message, data) {
            calls.push({ level: 'warn', message, data });
        },
        error(message, data) {
            calls.push({ level: 'error', message, data });
        },
        debug(message, data) {
            calls.push({ level: 'debug', message, data });
        }
    };
}

function createAuthManager() {
    return {
        isAuthenticated() {
            return true;
        },
        getCredentialProvider() {
            return async () => ({
                accessKeyId: 'test',
                secretAccessKey: 'test'
            });
        }
    };
}

function createConfig(logGroups) {
    return {
        aws: {
            region: 'eu-central-1',
            profile: 'test-profile'
        },
        cloudwatch: {
            logGroups,
            filterPattern: '',
            maxResults: 100000,
            monitorPatterns: [],
            exceptionPatterns: []
        }
    };
}

class TestCloudWatchClient extends CloudWatchClient {
    constructor(config, logger, authManager, fakeClient) {
        super(config, logger, authManager);
        this.fakeClient = fakeClient;
    }

    async rebuildClient() {
        this.client = this.fakeClient;
    }
}

test('CloudWatchClient risolve prefix paginati all avvio e deduplica i nomi', async () => {
    const logger = createLogger();
    const sentCommands = [];
    const fakeClient = {
        async send(command) {
            sentCommands.push(command);
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                assert.equal(
                    command.input.logGroupNamePrefix,
                    '/eks/ns/generated-worker-'
                );
                if (!command.input.nextToken) {
                    return {
                        logGroups: [
                            { logGroupName: '/eks/ns/generated-worker-002' },
                            { logGroupName: '/eks/ns/static-worker-prod' }
                        ],
                        nextToken: 'page-2'
                    };
                }
                return {
                    logGroups: [
                        { logGroupName: '/eks/ns/generated-worker-001' }
                    ]
                };
            }

            assert.equal(command.constructor.name, 'FilterLogEventsCommand');
            return { events: [] };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([
            { type: 'complete', name: '/eks/ns/static-worker-prod' },
            { type: 'prefix', prefix: '/eks/ns/generated-worker-' }
        ]),
        logger,
        createAuthManager(),
        fakeClient
    );

    await client.init();

    assert.deepEqual(client.logGroups, [
        '/eks/ns/static-worker-prod',
        '/eks/ns/generated-worker-001',
        '/eks/ns/generated-worker-002'
    ]);
    assert.equal(
        sentCommands.filter(command => command.constructor.name === 'DescribeLogGroupsCommand').length,
        2
    );
    assert.equal(
        sentCommands.some(command =>
            command.constructor.name === 'FilterLogEventsCommand'
            && command.input.logGroupName === '/eks/ns/static-worker-prod'
        ),
        true
    );
});

test('CloudWatchClient avvisa se un prefix non trova log group', async () => {
    const logger = createLogger();
    const fakeClient = {
        async send(command) {
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                return { logGroups: [] };
            }
            return { events: [] };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([
            { type: 'complete', name: '/eks/ns/static-worker-prod' },
            { type: 'prefix', prefix: '/eks/ns/missing-' }
        ]),
        logger,
        createAuthManager(),
        fakeClient
    );

    await client.init();

    assert.deepEqual(client.logGroups, ['/eks/ns/static-worker-prod']);
    assert.equal(
        logger.calls.some(call =>
            call.level === 'warn'
            && call.message === 'Nessun log group trovato per il prefix CloudWatch'
            && call.data.prefix === '/eks/ns/missing-'
        ),
        true
    );
});

test('CloudWatchClient fallisce se dopo la discovery non resta nessun log group', async () => {
    const fakeClient = {
        async send(command) {
            assert.equal(command.constructor.name, 'DescribeLogGroupsCommand');
            return { logGroups: [] };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([{ type: 'prefix', prefix: '/eks/ns/missing-' }]),
        createLogger(),
        createAuthManager(),
        fakeClient
    );

    await assert.rejects(
        () => client.init(),
        /Nessun log group CloudWatch risolto/
    );
});

test('CloudWatchClient scarica eventi solo dai nomi concreti risolti', async () => {
    const fetchedGroups = [];
    const fakeClient = {
        async send(command) {
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                return {
                    logGroups: [
                        { logGroupName: '/eks/ns/generated-worker-001' },
                        { logGroupName: '/eks/ns/generated-worker-002' }
                    ]
                };
            }

            fetchedGroups.push(command.input.logGroupName);
            return {
                events: [{
                    timestamp: command.input.logGroupName.endsWith('001') ? 1 : 2,
                    message: command.input.logGroupName
                }]
            };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([{ type: 'prefix', prefix: '/eks/ns/generated-worker-' }]),
        createLogger(),
        createAuthManager(),
        fakeClient
    );

    await client.init({ skipCredentialTest: true });
    const events = await client.fetchLogsPaginated(0, 10);

    assert.deepEqual(fetchedGroups, [
        '/eks/ns/generated-worker-001',
        '/eks/ns/generated-worker-002'
    ]);
    assert.deepEqual(
        events.map(event => event.logGroupName),
        [
            '/eks/ns/generated-worker-001',
            '/eks/ns/generated-worker-002'
        ]
    );
});
