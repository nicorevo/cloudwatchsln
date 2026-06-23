const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ProjectRunner,
    buildSyntheticProjectConfig
} = require('../src/project-runner');

const ROOT_CONFIG = {
    environment: 'prod',
    aws: {
        region: 'eu-central-1',
        profile: 'test-profile'
    }
};

const PROJECT_ENTRY = {
    project: 'prj01',
    logGroups: ['/eks/ns/worker-prod'],
    filterPattern: 'ERROR',
    maxResults: 50000,
    monitorPatterns: [],
    exceptionPatterns: [' ERROR '],
    excludeExceptionPatterns: ['Known harmless error'],
    schedule: {
        downloadInterval: '*/1 * * * *',
        cleanupInterval: '*/60 * * * *'
    },
    files: {
        logDirectory: './logs',
        filePrefix: 'prj01-logs-prod',
        retentionMinutes: 60,
        preserveExceptionPairs: true
    },
    logging: {
        level: 'info',
        enableConsole: true
    }
};

function createLogger() {
    const calls = [];
    return {
        calls,
        info(message, data) {
            calls.push({ level: 'info', message, data });
        },
        error(message, data) {
            calls.push({ level: 'error', message, data });
        },
        debug() {},
        warn() {}
    };
}

test('buildSyntheticProjectConfig shaped come config monoprogetto', () => {
    const config = buildSyntheticProjectConfig(ROOT_CONFIG, PROJECT_ENTRY);

    assert.equal(config.environment, 'prod');
    assert.equal(config.project, 'prj01');
    assert.deepEqual(config.aws, ROOT_CONFIG.aws);
    assert.deepEqual(config.cloudwatch.logGroups, ['/eks/ns/worker-prod']);
    assert.equal(config.cloudwatch.filterPattern, 'ERROR');
    assert.equal(config.cloudwatch.maxResults, 50000);
    assert.deepEqual(
        config.cloudwatch.excludeExceptionPatterns,
        ['Known harmless error']
    );
    assert.deepEqual(config.schedule, PROJECT_ENTRY.schedule);
    assert.deepEqual(config.files, PROJECT_ENTRY.files);
    assert.deepEqual(config.logging, PROJECT_ENTRY.logging);
});

test('ProjectRunner downloadLogs scrive eventi e aggiorna lastProcessedTime', async () => {
    const logger = createLogger();
    const startTime = Date.now() - 60000;
    let writtenEvents = null;

    const cloudWatchClient = {
        initialized: true,
        async fetchLogsPaginated(from, to) {
            assert.ok(from <= to);
            return [{ timestamp: Date.now(), message: 'event-1' }];
        }
    };

    const fileManager = {
        async writeLogsToFile(events) {
            writtenEvents = events;
        }
    };

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, logger, {
        cloudWatchClient,
        fileManager,
        lastProcessedTime: startTime
    });

    await runner.downloadLogs();

    assert.equal(writtenEvents.length, 1);
    assert.ok(runner.lastProcessedTime > startTime);
    assert.equal(logger.calls.some(call => call.message === 'Download complete: 1 events processed'), true);
    assert.equal(logger.calls.some(call => call.data?.project === 'prj01'), true);
});

test('ProjectRunner downloadLogs aggiorna lastProcessedTime anche senza eventi', async () => {
    const logger = createLogger();
    const startTime = Date.now() - 60000;

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, logger, {
        cloudWatchClient: {
            async fetchLogsPaginated() {
                return [];
            }
        },
        fileManager: {
            async writeLogsToFile() {
                throw new Error('writeLogsToFile non deve essere chiamato');
            }
        },
        lastProcessedTime: startTime
    });

    await runner.downloadLogs();

    assert.ok(runner.lastProcessedTime > startTime);
    assert.equal(logger.calls.some(call => call.message === 'No new logs found for the specified period'), true);
});

test('ProjectRunner downloadLogs non propaga errori CloudWatch', async () => {
    const logger = createLogger();
    const startTime = Date.now() - 60000;

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, logger, {
        cloudWatchClient: {
            async fetchLogsPaginated() {
                throw new Error('AWS unavailable');
            }
        },
        fileManager: {
            async writeLogsToFile() {
                throw new Error('non deve essere chiamato');
            }
        },
        lastProcessedTime: startTime
    });

    await runner.downloadLogs();

    assert.equal(runner.lastProcessedTime, startTime);
    const errorCall = logger.calls.find(call => call.level === 'error');
    assert.ok(errorCall);
    assert.equal(errorCall.data.project, 'prj01');
    assert.match(errorCall.data.message, /AWS unavailable/);
});

test('ProjectRunner cleanupOldFiles delega a FileManager', async () => {
    const logger = createLogger();
    let cleanupCalled = false;

    const fileManager = {
        async cleanupOldFiles() {
            cleanupCalled = true;
        },
        async getFileList() {
            return [{ name: 'a.log', size: 10 }];
        }
    };

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, logger, {
        cloudWatchClient: { async fetchLogsPaginated() { return []; } },
        fileManager
    });

    await runner.cleanupOldFiles();

    assert.equal(cleanupCalled, true);
    assert.equal(logger.calls.some(call => call.message === 'Starting old file cleanup...'), true);
});

test('ProjectRunner cleanupOldFiles non propaga errori', async () => {
    const logger = createLogger();

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, logger, {
        cloudWatchClient: { async fetchLogsPaginated() { return []; } },
        fileManager: {
            async cleanupOldFiles() {
                throw new Error('disk full');
            }
        }
    });

    await runner.cleanupOldFiles();

    const errorCall = logger.calls.find(call => call.level === 'error');
    assert.ok(errorCall);
    assert.equal(errorCall.data.project, 'prj01');
});

test('ProjectRunner init delega a CloudWatchClient.init', async () => {
    let initOptions = null;

    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, createLogger(), {
        cloudWatchClient: {
            async init(options) {
                initOptions = options;
            }
        },
        fileManager: {
            async cleanupOldFiles() {},
            async getFileList() { return []; }
        }
    });

    await runner.init({ skipCredentialTest: true });
    assert.deepEqual(initOptions, { skipCredentialTest: true });
});

test('ProjectRunner getMonitorDescriptor espone metadati monitor', () => {
    const runner = new ProjectRunner(ROOT_CONFIG, PROJECT_ENTRY, {}, createLogger(), {
        cloudWatchClient: { async fetchLogsPaginated() { return []; } },
        fileManager: { async cleanupOldFiles() {}, async getFileList() { return []; } }
    });

    assert.deepEqual(runner.getMonitorDescriptor(), {
        project: 'prj01',
        filePrefix: 'prj01-logs-prod',
        logDirectory: './logs',
        exceptionPatterns: [' ERROR '],
        excludeExceptionPatterns: ['Known harmless error']
    });
});
