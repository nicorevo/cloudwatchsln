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
            exceptionPatterns: [' ERROR ']
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
    assert.deepEqual(entry.logGroups, ['/eks/ns/worker-prod']);
    assert.deepEqual(entry.exceptionPatterns, [' ERROR ']);
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

    assert.deepEqual(normalized.cloudwatch[0].logGroups, ['/eks/ns/legacy-prod']);
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
