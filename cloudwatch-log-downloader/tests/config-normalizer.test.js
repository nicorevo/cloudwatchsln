const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs-extra');

const {
    normalizeConfig,
    PROJECT_ID_PATTERN
} = require('../src/config-normalizer');

const BASE_AWS = {
    region: 'eu-central-1',
    profile: 'test-profile'
};

const BASE_MONITOR = {
    enabled: true,
    host: '127.0.0.1',
    port: 3847
};

function completeLogGroup(name) {
    return { type: 'complete', name };
}

function prefixLogGroup(prefix) {
    return { type: 'prefix', prefix };
}

function legacyConfig(overrides = {}) {
    return {
        environment: 'prod',
        project: 'prj01',
        aws: BASE_AWS,
        monitor: BASE_MONITOR,
        cloudwatch: {
            logGroups: ['/eks/ns/worker-prod'],
            filterPattern: '',
            maxResults: 100000,
            monitorPatterns: [],
            exceptionPatterns: [' ERROR '],
            excludeExceptionPatterns: ['Known harmless error']
        },
        schedule: {
            downloadInterval: '*/1 * * * *',
            cleanupInterval: '*/60 * * * *'
        },
        files: {
            logDirectory: './logs',
            retentionMinutes: 60,
            filePrefix: 'prj01-logs-prod',
            preserveExceptionPairs: true
        },
        logging: {
            level: 'info',
            enableConsole: true
        },
        ...overrides
    };
}

function multiProjectEntry(project, overrides = {}) {
    return {
        project,
        logGroups: [`/eks/ns/${project}-prod`],
        exceptionPatterns: [' ERROR '],
        schedule: {
            downloadInterval: '*/1 * * * *',
            cleanupInterval: '*/60 * * * *'
        },
        files: {
            logDirectory: './logs',
            filePrefix: `${project}-logs-prod`,
            retentionMinutes: 60,
            preserveExceptionPairs: true
        },
        logging: {
            level: 'info',
            enableConsole: true
        },
        ...overrides
    };
}

test('PROJECT_ID_PATTERN accetta slug kebab-case validi', () => {
    assert.match('prj01', PROJECT_ID_PATTERN);
    assert.match('a1', PROJECT_ID_PATTERN);
    assert.doesNotMatch('Download-Mail', PROJECT_ID_PATTERN);
    assert.doesNotMatch('-bad', PROJECT_ID_PATTERN);
    assert.doesNotMatch('', PROJECT_ID_PATTERN);
});

test('normalizeConfig migra config legacy monoprogetto in cloudwatch[]', () => {
    const normalized = normalizeConfig(legacyConfig());

    assert.equal(normalized.environment, 'prod');
    assert.deepEqual(normalized.aws, BASE_AWS);
    assert.deepEqual(normalized.monitor, BASE_MONITOR);
    assert.equal(normalized.cloudwatch.length, 1);

    const entry = normalized.cloudwatch[0];
    assert.equal(entry.project, 'prj01');
    assert.deepEqual(entry.logGroups, [completeLogGroup('/eks/ns/worker-prod')]);
    assert.deepEqual(entry.exceptionPatterns, [' ERROR ']);
    assert.deepEqual(entry.excludeExceptionPatterns, ['Known harmless error']);
    assert.equal(entry.files.filePrefix, 'prj01-logs-prod');
    assert.equal(entry.schedule.downloadInterval, '*/1 * * * *');
    assert.equal(entry.logging.level, 'info');
});

test('normalizeConfig migra legacy con logGroupName singolo', () => {
    const normalized = normalizeConfig(legacyConfig({
        cloudwatch: {
            logGroupName: '/eks/ns/legacy-prod',
            exceptionPatterns: []
        }
    }));

    assert.deepEqual(normalized.cloudwatch[0].logGroups, [
        completeLogGroup('/eks/ns/legacy-prod')
    ]);
});

test('normalizeConfig accetta logGroups complete e prefix espliciti', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            logGroups: [
                { complete: '/eks/ns/static-worker-prod' },
                { prefix: '/eks/ns/generated-worker-' }
            ]
        })]
    });

    assert.deepEqual(normalized.cloudwatch[0].logGroups, [
        completeLogGroup('/eks/ns/static-worker-prod'),
        prefixLogGroup('/eks/ns/generated-worker-')
    ]);
});

test('normalizeConfig taglia spazi da logGroups complete e prefix', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            logGroups: [
                '  /eks/ns/legacy-prod  ',
                { complete: '  /eks/ns/static-worker-prod  ' },
                { prefix: '  /eks/ns/generated-worker-  ' }
            ]
        })]
    });

    assert.deepEqual(normalized.cloudwatch[0].logGroups, [
        completeLogGroup('/eks/ns/legacy-prod'),
        completeLogGroup('/eks/ns/static-worker-prod'),
        prefixLogGroup('/eks/ns/generated-worker-')
    ]);
});

test('normalizeConfig rifiuta logGroups non validi', () => {
    for (const logGroups of [
        [''],
        [{ complete: '' }],
        [{ prefix: '' }],
        [{ name: '/eks/ns/old-shape' }],
        [{ type: 'prefix', prefix: '/eks/ns/internal-shape-' }],
        [{ complete: '/eks/ns/x', prefix: '/eks/ns/' }],
        [42],
        [null]
    ]) {
        assert.throws(
            () => normalizeConfig({
                aws: BASE_AWS,
                cloudwatch: [multiProjectEntry('prj01', { logGroups })]
            }),
            /logGroups\[\] contiene un entry non valido per progetto prj01/
        );
    }
});

test('normalizeConfig normalizza cloudwatch[] multi-progetto', () => {
    const normalized = normalizeConfig({
        environment: 'uat',
        aws: BASE_AWS,
        monitor: BASE_MONITOR,
        cloudwatch: [
            multiProjectEntry('prj01'),
            multiProjectEntry('other-service', {
                schedule: { downloadInterval: '*/2 * * * *', cleanupInterval: '0 */2 * * *' },
                logging: { level: 'warn', enableConsole: false }
            })
        ]
    });

    assert.equal(normalized.cloudwatch.length, 2);
    assert.equal(normalized.cloudwatch[0].project, 'prj01');
    assert.equal(normalized.cloudwatch[1].project, 'other-service');
    assert.equal(normalized.cloudwatch[1].schedule.downloadInterval, '*/2 * * * *');
    assert.equal(normalized.cloudwatch[1].logging.level, 'warn');
    assert.equal(normalized.cloudwatch[1].logging.enableConsole, false);
});

test('normalizeConfig applica default schedule files e logging mancanti', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [{
            project: 'minimal',
            logGroups: ['/eks/ns/minimal-prod'],
            files: { filePrefix: 'minimal-logs-prod' }
        }]
    });

    const entry = normalized.cloudwatch[0];
    assert.equal(entry.schedule.downloadInterval, '*/1 * * * *');
    assert.equal(entry.schedule.cleanupInterval, '*/60 * * * *');
    assert.equal(entry.files.logDirectory, './logs');
    assert.equal(entry.files.retentionMinutes, 60);
    assert.equal(entry.files.preserveExceptionPairs, true);
    assert.equal(entry.logging.level, 'info');
    assert.equal(entry.logging.enableConsole, true);
    assert.equal(entry.filterPattern, '');
    assert.equal(entry.maxResults, 100000);
    assert.deepEqual(entry.monitorPatterns, []);
    assert.deepEqual(entry.exceptionPatterns, []);
    assert.deepEqual(entry.excludeExceptionPatterns, []);
    assert.deepEqual(entry.channels, []);
    assert.deepEqual(entry.logGroupDiscovery, {
        activeWindowHours: 4,
        refreshIntervalMinutes: 10,
        eventualConsistencyGraceMinutes: 90
    });
});

test('normalizeConfig normalizza override logGroupDiscovery per progetto', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            logGroupDiscovery: {
                activeWindowHours: 2,
                refreshIntervalMinutes: 0,
                eventualConsistencyGraceMinutes: 0
            }
        })]
    });

    assert.deepEqual(normalized.cloudwatch[0].logGroupDiscovery, {
        activeWindowHours: 2,
        refreshIntervalMinutes: 0,
        eventualConsistencyGraceMinutes: 0
    });
});

test('normalizeConfig rifiuta logGroupDiscovery non valido', () => {
    for (const logGroupDiscovery of [
        { activeWindowHours: 0 },
        { activeWindowHours: -1 },
        { activeWindowHours: '4' },
        { refreshIntervalMinutes: -1 },
        { refreshIntervalMinutes: 2.5 },
        { refreshIntervalMinutes: '10' },
        { eventualConsistencyGraceMinutes: -1 },
        { eventualConsistencyGraceMinutes: 2.5 },
        { eventualConsistencyGraceMinutes: '90' }
    ]) {
        assert.throws(
            () => normalizeConfig({
                aws: BASE_AWS,
                cloudwatch: [multiProjectEntry('prj01', { logGroupDiscovery })]
            }),
            /logGroupDiscovery non valido per progetto prj01/
        );
    }
});

test('normalizeConfig normalizza channel Slack senza materializzare il webhook', () => {
    const envName = 'TEST_SLACK_WEBHOOK_URL';
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            channels: [{
                id: 'operations-slack',
                type: 'slack',
                webhookUrlEnv: envName
            }]
        })]
    }, {
        env: {
            [envName]: 'https://hooks.slack.com/services/T000/B000/TEST_TOKEN'
        }
    });

    assert.deepEqual(normalized.cloudwatch[0].channels, [{
        id: 'operations-slack',
        type: 'slack',
        enabled: true,
        webhookUrlEnv: envName
    }]);
    assert.doesNotMatch(JSON.stringify(normalized), /T000|TEST_TOKEN/);
});

test('normalizeConfig accetta channel disabilitato senza variabile ambiente', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            channels: [{
                id: 'disabled-slack',
                type: 'slack',
                enabled: false,
                webhookUrlEnv: 'MISSING_DISABLED_WEBHOOK'
            }]
        })]
    }, { env: {} });

    assert.equal(normalized.cloudwatch[0].channels[0].enabled, false);
});

test('normalizeConfig rifiuta configurazioni channel non valide', () => {
    const cases = [
        {
            channels: 'slack',
            pattern: /channels deve essere un array/
        },
        {
            channels: [{ id: 'Bad ID', type: 'slack', webhookUrlEnv: 'X' }],
            pattern: /channel id non valido/
        },
        {
            channels: [
                { id: 'same', type: 'slack', enabled: false, webhookUrlEnv: 'A' },
                { id: 'same', type: 'slack', enabled: false, webhookUrlEnv: 'B' }
            ],
            pattern: /channel id duplicato/
        },
        {
            channels: [{ id: 'unknown', type: 'email', enabled: false }],
            pattern: /tipo channel non supportato/
        },
        {
            channels: [{ id: 'slack', type: 'slack', enabled: 'yes', webhookUrlEnv: 'X' }],
            pattern: /enabled deve essere boolean/
        },
        {
            channels: [{ id: 'slack', type: 'slack', webhookUrlEnv: 'not-valid-env' }],
            pattern: /webhookUrlEnv non valido/
        },
        {
            channels: [{ id: 'slack', type: 'slack', webhookUrlEnv: 'MISSING_WEBHOOK' }],
            pattern: /variabile ambiente MISSING_WEBHOOK mancante/
        }
    ];

    for (const entry of cases) {
        assert.throws(
            () => normalizeConfig({
                aws: BASE_AWS,
                cloudwatch: [multiProjectEntry('prj01', {
                    channels: entry.channels
                })]
            }, { env: {} }),
            entry.pattern
        );
    }
});

test('normalizeConfig rifiuta webhook Slack non HTTPS o con host differente', () => {
    const envName = 'TEST_INVALID_SLACK_WEBHOOK';
    for (const value of [
        'http://hooks.slack.com/services/test',
        'https://example.com/services/test',
        'https://hooks.slack.com/not-services/test',
        'not-a-url'
    ]) {
        assert.throws(
            () => normalizeConfig({
                aws: BASE_AWS,
                cloudwatch: [multiProjectEntry('prj01', {
                    channels: [{
                        id: 'slack',
                        type: 'slack',
                        webhookUrlEnv: envName
                    }]
                })]
            }, { env: { [envName]: value } }),
            /webhook Slack non valido/
        );
    }
});

test('normalizeConfig normalizza excludeExceptionPatterns per progetto', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [
            multiProjectEntry('prj01', {
                excludeExceptionPatterns: ['ignored-a']
            }),
            multiProjectEntry('other-service', {
                excludeExceptionPatterns: ['ignored-b']
            })
        ]
    });

    assert.deepEqual(normalized.cloudwatch[0].excludeExceptionPatterns, ['ignored-a']);
    assert.deepEqual(normalized.cloudwatch[1].excludeExceptionPatterns, ['ignored-b']);
    assert.notEqual(
        normalized.cloudwatch[0].excludeExceptionPatterns,
        normalized.cloudwatch[1].excludeExceptionPatterns
    );
});

test('normalizeConfig usa array vuoto per excludeExceptionPatterns non array', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            excludeExceptionPatterns: 'ignored'
        })]
    });

    assert.deepEqual(normalized.cloudwatch[0].excludeExceptionPatterns, []);
});

test('normalizeConfig rifiuta cloudwatch[] vuoto', () => {
    assert.throws(
        () => normalizeConfig({ aws: BASE_AWS, cloudwatch: [] }),
        /cloudwatch deve contenere almeno un progetto/
    );
});

test('normalizeConfig rifiuta cloudwatch assente', () => {
    assert.throws(
        () => normalizeConfig({ aws: BASE_AWS }),
        /cloudwatch deve contenere almeno un progetto/
    );
});

test('normalizeConfig rifiuta project duplicati', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [
                multiProjectEntry('prj01'),
                multiProjectEntry('prj01', { files: { filePrefix: 'other-prefix' } })
            ]
        }),
        /project duplicato: prj01/
    );
});

test('normalizeConfig rifiuta filePrefix duplicati', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [
                multiProjectEntry('prj01'),
                multiProjectEntry('other-service', { files: { filePrefix: 'prj01-logs-prod' } })
            ]
        }),
        /filePrefix duplicato: prj01-logs-prod/
    );
});

test('normalizeConfig normalizza logging.level in minuscolo', () => {
    const normalized = normalizeConfig({
        aws: BASE_AWS,
        cloudwatch: [multiProjectEntry('prj01', {
            logging: { level: 'DEBUG', enableConsole: true }
        })]
    });

    assert.equal(normalized.cloudwatch[0].logging.level, 'debug');
});

test('normalizeConfig rifiuta project con slug non valido', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [multiProjectEntry('Download-Mail')]
        }),
        /project non valido: Download-Mail/
    );
});

test('normalizeConfig rifiuta entry senza project', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [{
                logGroups: ['/eks/ns/x-prod'],
                files: { filePrefix: 'x-logs-prod' }
            }]
        }),
        /project mancante/
    );
});

test('normalizeConfig rifiuta entry senza logGroups', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [multiProjectEntry('empty-groups', { logGroups: [] })]
        }),
        /logGroups\[\] obbligatorio per progetto empty-groups/
    );
});

test('normalizeConfig rifiuta entry senza files.filePrefix', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: [{
                project: 'no-prefix',
                logGroups: ['/eks/ns/no-prefix-prod'],
                files: { logDirectory: './logs' }
            }]
        }),
        /files\.filePrefix obbligatorio per progetto no-prefix/
    );
});

test('normalizeConfig rifiuta legacy senza project root', () => {
    assert.throws(
        () => normalizeConfig({
            aws: BASE_AWS,
            cloudwatch: { logGroups: ['/eks/ns/x-prod'] },
            files: { filePrefix: 'x-logs-prod' }
        }),
        /Config legacy: campo project mancante/
    );
});

test('normalizeConfig accetta config.sample.json multi-progetto', async () => {
    const samplePath = path.join(__dirname, '..', 'config.sample.json');
    const sample = await fs.readJson(samplePath);
    const normalized = normalizeConfig(sample);

    assert.equal(normalized.cloudwatch.length, 2);
    assert.equal(normalized.cloudwatch[0].project, 'prj01');
    assert.equal(normalized.cloudwatch[1].project, 'prj02');
    assert.ok(normalized.cloudwatch.every(entry => entry.files.filePrefix));
});
