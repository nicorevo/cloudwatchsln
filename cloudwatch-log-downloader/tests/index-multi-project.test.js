const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CloudWatchLogDownloader = require('../src/index');

const LEGACY_CONFIG = path.join(__dirname, 'fixtures', 'config-legacy.json');
const MULTI_CONFIG = path.join(__dirname, 'fixtures', 'config-multi.json');
const COMPLETE_WORKER_LOG_GROUP = { type: 'complete', name: '/eks/ns/worker-prod' };

test('loadConfig normalizza config legacy monoprogetto', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: LEGACY_CONFIG });

    await downloader.loadConfig();

    assert.equal(downloader.config.cloudwatch.length, 1);
    assert.equal(downloader.config.cloudwatch[0].project, 'prj01');
    assert.deepEqual(downloader.config.cloudwatch[0].logGroups, [
        COMPLETE_WORKER_LOG_GROUP
    ]);
    assert.equal(downloader.config.cloudwatch[0].files.filePrefix, 'prj01-logs-prod');
    assert.equal(downloader.config.aws.region, 'eu-central-1');
    assert.equal(downloader.config.monitor.enabled, false);
});

test('loadConfig accetta cloudwatch[] multi-progetto', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });

    await downloader.loadConfig();

    assert.equal(downloader.config.cloudwatch.length, 2);
    assert.equal(downloader.config.cloudwatch[0].project, 'prj01');
    assert.equal(downloader.config.cloudwatch[1].project, 'other-service');
    assert.equal(downloader.config.cloudwatch[1].schedule.downloadInterval, '*/2 * * * *');
});

test('validateAwsConfig rifiuta config senza aws.region', () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });

    assert.throws(
        () => downloader.validateAwsConfig({ aws: { profile: 'x' } }),
        /aws\.region/
    );
});

test('getMonitorProjectDescriptors restituisce un descriptor per runner', () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    downloader.projectRunners = [
        {
            getMonitorDescriptor() {
                return {
                    project: 'prj01',
                    filePrefix: 'prj01-logs-prod',
                    logDirectory: './logs',
                    exceptionPatterns: [' ERROR '],
                    excludeExceptionPatterns: ['Known harmless error']
                };
            },
            config: {
                files: { logDirectory: './logs' }
            }
        },
        {
            getMonitorDescriptor() {
                return {
                    project: 'other-service',
                    filePrefix: 'other-service-logs-prod',
                    logDirectory: './logs',
                    exceptionPatterns: ['Exception'],
                    excludeExceptionPatterns: []
                };
            },
            config: {
                files: { logDirectory: './logs' }
            }
        }
    ];

    const descriptors = downloader.getMonitorProjectDescriptors();

    assert.equal(descriptors.length, 2);
    assert.equal(descriptors[0].project, 'prj01');
    assert.equal(descriptors[1].filePrefix, 'other-service-logs-prod');
    assert.deepEqual(descriptors[0].exceptionPatterns, [' ERROR ']);
    assert.deepEqual(
        descriptors[0].excludeExceptionPatterns,
        ['Known harmless error']
    );
    assert.ok(descriptors[0].logDirectoryResolved.includes('logs'));
});

test('downloadAllProjects invoca downloadLogs su ogni runner', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    const calls = [];

    downloader.projectRunners = [
        { async downloadLogs() { calls.push('a'); } },
        { async downloadLogs() { calls.push('b'); } }
    ];

    await downloader.downloadAllProjects();

    assert.deepEqual(calls.sort(), ['a', 'b']);
});

test('cleanupAllProjects invoca cleanupOldFiles su ogni runner', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    const calls = [];

    downloader.projectRunners = [
        { async cleanupOldFiles() { calls.push('a'); } },
        { async cleanupOldFiles() { calls.push('b'); } }
    ];

    await downloader.cleanupAllProjects();

    assert.deepEqual(calls.sort(), ['a', 'b']);
});

test('closeProjectRunners chiude tutti i manager di notifica', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    const calls = [];
    downloader.projectRunners = [
        { async close(options) { calls.push(`a-${options.timeoutMs}`); } },
        { async close(options) { calls.push(`b-${options.timeoutMs}`); } }
    ];

    await downloader.closeProjectRunners({ timeoutMs: 15000 });

    assert.deepEqual(calls.sort(), ['a-15000', 'b-15000']);
});

test('stopScheduledJobs ferma tutti i cron registrati', () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    const stopped = [];

    downloader.scheduledJobs = [
        {
            downloadJob: { stop() { stopped.push('d1'); } },
            cleanupJob: { stop() { stopped.push('c1'); } },
            discoveryJob: { stop() { stopped.push('r1'); } }
        },
        {
            downloadJob: { stop() { stopped.push('d2'); } },
            cleanupJob: { stop() { stopped.push('c2'); } },
            discoveryJob: null
        }
    ];

    downloader.stopScheduledJobs();

    assert.deepEqual(stopped.sort(), ['c1', 'c2', 'd1', 'd2', 'r1']);
});

test('startScheduledJobs schedula refresh discovery per progetti con prefix', () => {
    const scheduled = [];
    const fakeCron = {
        schedule(interval, handler, options) {
            const job = {
                interval,
                handler,
                options,
                stopped: false,
                stop() { this.stopped = true; }
            };
            scheduled.push(job);
            return job;
        }
    };
    const downloader = new CloudWatchLogDownloader({
        configPath: MULTI_CONFIG,
        cron: fakeCron
    });
    const refreshCalls = [];
    downloader.logger = { info() {}, warn() {}, error() {} };
    downloader.config = {
        aws: { credentialRefreshIntervalMinutes: 55 },
        cloudwatch: [],
        monitor: { enabled: false }
    };
    downloader.startCredentialRefreshJob = () => {};
    downloader.registerShutdownHandlers = () => {};
    downloader.projectRunners = [
        {
            project: 'with-prefix',
            config: {
                schedule: {
                    downloadInterval: '*/1 * * * *',
                    cleanupInterval: '*/60 * * * *'
                },
                cloudwatch: {
                    logGroups: [{ type: 'prefix', prefix: '/eks/ns/job-' }],
                    logGroupDiscovery: {
                        activeWindowHours: 4,
                        refreshIntervalMinutes: 10
                    }
                }
            },
            async downloadLogs() {},
            async cleanupOldFiles() {},
            async refreshLogGroupDiscovery() { refreshCalls.push('with-prefix'); }
        },
        {
            project: 'complete-only',
            config: {
                schedule: {
                    downloadInterval: '*/2 * * * *',
                    cleanupInterval: '*/30 * * * *'
                },
                cloudwatch: {
                    logGroups: [{ type: 'complete', name: '/eks/ns/api' }],
                    logGroupDiscovery: {
                        activeWindowHours: 4,
                        refreshIntervalMinutes: 10
                    }
                }
            },
            async downloadLogs() {},
            async cleanupOldFiles() {},
            async refreshLogGroupDiscovery() { refreshCalls.push('complete-only'); }
        }
    ];

    downloader.startScheduledJobs();

    assert.equal(scheduled.length, 5);
    assert.equal(
        scheduled.some(job => job.interval === '*/10 * * * *'),
        true
    );

    const discoveryJob = downloader.scheduledJobs.find(job =>
        job.project === 'with-prefix'
    ).discoveryJob;
    assert.ok(discoveryJob);

    discoveryJob.handler();

    assert.deepEqual(refreshCalls, ['with-prefix']);
});

test('registerShutdownHandlers registra listener una sola volta', () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    downloader.logger = { info() {}, error() {} };
    downloader.config = { monitor: { enabled: false } };
    downloader.projectRunners = [];

    const sigintBefore = new Set(process.listeners('SIGINT'));
    const sigtermBefore = new Set(process.listeners('SIGTERM'));

    downloader.registerShutdownHandlers();
    const sigintAfterFirst = process.listenerCount('SIGINT');
    const sigtermAfterFirst = process.listenerCount('SIGTERM');

    downloader.registerShutdownHandlers();

    assert.equal(process.listenerCount('SIGINT'), sigintAfterFirst);
    assert.equal(process.listenerCount('SIGTERM'), sigtermAfterFirst);
    assert.equal(sigintAfterFirst, sigintBefore.size + 1);
    assert.equal(sigtermAfterFirst, sigtermBefore.size + 1);
    assert.equal(downloader.shutdownHandlersRegistered, true);

    process.listeners('SIGINT')
        .filter(listener => !sigintBefore.has(listener))
        .forEach(listener => process.removeListener('SIGINT', listener));
    process.listeners('SIGTERM')
        .filter(listener => !sigtermBefore.has(listener))
        .forEach(listener => process.removeListener('SIGTERM', listener));
});
