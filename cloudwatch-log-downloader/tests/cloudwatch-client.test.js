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
            logGroupDiscovery: {
                activeWindowHours: 4,
                refreshIntervalMinutes: 10
            },
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

            if (command.constructor.name === 'DescribeLogStreamsCommand') {
                return {
                    logStreams: [{
                        lastEventTimestamp: Date.now() - 60 * 60 * 1000
                    }]
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
        sentCommands.filter(command => command.constructor.name === 'DescribeLogStreamsCommand').length,
        3
    );
    assert.equal(
        sentCommands.some(command =>
            command.constructor.name === 'FilterLogEventsCommand'
            && command.input.logGroupName === '/eks/ns/static-worker-prod'
        ),
        true
    );
});

test('CloudWatchClient include solo prefix attivi nella finestra configurata', async () => {
    const now = Date.parse('2026-06-24T10:00:00.000Z');
    const sentCommands = [];
    const fakeClient = {
        async send(command) {
            sentCommands.push(command);
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                return {
                    logGroups: [
                        { logGroupName: '/eks/ns/generated-active' },
                        { logGroupName: '/eks/ns/generated-old' },
                        { logGroupName: '/eks/ns/generated-empty' }
                    ]
                };
            }

            if (command.constructor.name === 'DescribeLogStreamsCommand') {
                assert.equal(command.input.orderBy, 'LastEventTime');
                assert.equal(command.input.descending, true);
                assert.equal(command.input.limit, 1);
                if (command.input.logGroupName.endsWith('active')) {
                    return {
                        logStreams: [{
                            lastEventTimestamp: now - (3 * 60 * 60 * 1000)
                        }]
                    };
                }
                if (command.input.logGroupName.endsWith('old')) {
                    return {
                        logStreams: [{
                            lastEventTimestamp: now - (5 * 60 * 60 * 1000)
                        }]
                    };
                }
                return { logStreams: [] };
            }

            return { events: [] };
        }
    };
    const config = createConfig([
        { type: 'prefix', prefix: '/eks/ns/generated-' }
    ]);
    const client = new TestCloudWatchClient(
        config,
        createLogger(),
        createAuthManager(),
        fakeClient
    );

    await client.init({ skipCredentialTest: true, now });

    assert.deepEqual(client.logGroups, ['/eks/ns/generated-active']);
    assert.equal(
        sentCommands.filter(command => command.constructor.name === 'DescribeLogStreamsCommand').length,
        3
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

            if (command.constructor.name === 'DescribeLogStreamsCommand') {
                return {
                    logStreams: [{
                        lastEventTimestamp: Date.now() - 60 * 60 * 1000
                    }]
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

test('CloudWatchClient refresh aggiorna prefix aggiungendo nuovi attivi e rimuovendo inattivi', async () => {
    const now = Date.parse('2026-06-24T10:00:00.000Z');
    let discoveryRun = 0;
    const fakeClient = {
        async send(command) {
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                discoveryRun++;
                return {
                    logGroups: discoveryRun === 1
                        ? [
                            { logGroupName: '/eks/ns/generated-old' },
                            { logGroupName: '/eks/ns/generated-stays' }
                        ]
                        : [
                            { logGroupName: '/eks/ns/generated-stays' },
                            { logGroupName: '/eks/ns/generated-new' }
                        ]
                };
            }

            if (command.constructor.name === 'DescribeLogStreamsCommand') {
                if (command.input.logGroupName.endsWith('old')) {
                    return {
                        logStreams: [{
                            lastEventTimestamp: now - (5 * 60 * 60 * 1000)
                        }]
                    };
                }
                return {
                    logStreams: [{
                        lastEventTimestamp: now - (30 * 60 * 1000)
                    }]
                };
            }

            return { events: [] };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([{ type: 'prefix', prefix: '/eks/ns/generated-' }]),
        createLogger(),
        createAuthManager(),
        fakeClient
    );

    await client.init({ skipCredentialTest: true, now });
    assert.deepEqual(client.logGroups, ['/eks/ns/generated-stays']);

    await client.refreshConfiguredLogGroups({ now });

    assert.deepEqual(client.logGroups, [
        '/eks/ns/generated-new',
        '/eks/ns/generated-stays'
    ]);
});

test('CloudWatchClient non sovrappone refresh prefix concorrenti', async () => {
    const logger = createLogger();
    let releaseDiscovery;
    let describeCalls = 0;
    const fakeClient = {
        async send(command) {
            if (command.constructor.name === 'DescribeLogGroupsCommand') {
                describeCalls++;
                await new Promise(resolve => {
                    releaseDiscovery = resolve;
                });
                return {
                    logGroups: [{ logGroupName: '/eks/ns/generated-active' }]
                };
            }

            if (command.constructor.name === 'DescribeLogStreamsCommand') {
                return {
                    logStreams: [{
                        lastEventTimestamp: Date.now() - 60 * 60 * 1000
                    }]
                };
            }

            return { events: [] };
        }
    };
    const client = new TestCloudWatchClient(
        createConfig([{ type: 'prefix', prefix: '/eks/ns/generated-' }]),
        logger,
        createAuthManager(),
        fakeClient
    );
    client.client = fakeClient;
    client.initialized = true;
    client.logGroups = ['/eks/ns/generated-current'];

    const firstRefresh = client.refreshConfiguredLogGroups();
    const secondRefresh = client.refreshConfiguredLogGroups();
    releaseDiscovery();

    const secondResult = await secondRefresh;
    const firstResult = await firstRefresh;

    assert.deepEqual(secondResult, ['/eks/ns/generated-current']);
    assert.deepEqual(firstResult, ['/eks/ns/generated-active']);
    assert.equal(describeCalls, 1);
    assert.ok(logger.calls.some(call =>
        call.level === 'warn'
        && call.message === 'Discovery prefix CloudWatch gia in corso'
    ));
});
