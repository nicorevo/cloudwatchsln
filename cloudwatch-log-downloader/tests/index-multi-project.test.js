const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CloudWatchLogDownloader = require('../src/index');

const LEGACY_CONFIG = path.join(__dirname, 'fixtures', 'config-legacy.json');
const MULTI_CONFIG = path.join(__dirname, 'fixtures', 'config-multi.json');

test('loadConfig normalizza config legacy monoprogetto', async () => {
    const downloader = new CloudWatchLogDownloader({ configPath: LEGACY_CONFIG });

    await downloader.loadConfig();

    assert.equal(downloader.config.cloudwatch.length, 1);
    assert.equal(downloader.config.cloudwatch[0].project, 'prj01');
    assert.deepEqual(downloader.config.cloudwatch[0].logGroups, ['/eks/ns/worker-prod']);
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
                    exceptionPatterns: [' ERROR ']
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
                    exceptionPatterns: ['Exception']
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

test('stopScheduledJobs ferma tutti i cron registrati', () => {
    const downloader = new CloudWatchLogDownloader({ configPath: MULTI_CONFIG });
    const stopped = [];

    downloader.scheduledJobs = [
        {
            downloadJob: { stop() { stopped.push('d1'); } },
            cleanupJob: { stop() { stopped.push('c1'); } }
        },
        {
            downloadJob: { stop() { stopped.push('d2'); } },
            cleanupJob: { stop() { stopped.push('c2'); } }
        }
    ];

    downloader.stopScheduledJobs();

    assert.deepEqual(stopped.sort(), ['c1', 'c2', 'd1', 'd2']);
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
