const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');

const Logger = require('./logger');
const MonitorServer = require('./monitor/monitor-server');
const { AwsAuthManager } = require('./aws-auth-manager');
const { normalizeAwsConfig } = require('./aws-config');
const { normalizeMonitorConfig } = require('./monitor/monitor-config');
const { normalizeConfig } = require('./config-normalizer');
const { ProjectRunner } = require('./project-runner');

class CloudWatchLogDownloader {
    constructor(options = {}) {
        this.configPath = options.configPath ?? this.resolveConfigPath();
        this.ProjectRunnerClass = options.ProjectRunnerClass ?? ProjectRunner;
        this.AwsAuthManagerClass = options.AwsAuthManagerClass ?? AwsAuthManager;
        this.cron = options.cron ?? cron;
        this.config = null;
        this.logger = null;
        this.authManager = null;
        this.projectRunners = [];
        this.monitorServer = null;
        this.scheduledJobs = [];
        this.credentialRefreshTimer = null;
        this.shutdownHandlersRegistered = false;
    }

    resolveConfigPath() {
        const configDir = path.join(__dirname, '..');
        const configEnv = process.env.CONFIG_ENV;

        if (process.env.CONFIG_FILE) {
            return path.join(configDir, process.env.CONFIG_FILE);
        }

        if (!configEnv) {
            throw new Error(
                'CONFIG_ENV is not set. Use npm run start:uat or npm run start:prod. ' +
                'Copy config.sample.json to config.uat.json or config.prod.json.'
            );
        }

        return path.join(configDir, `config.${configEnv}.json`);
    }

    buildLoggerConfig() {
        // Livello log del servizio: usa logging del primo progetto in cloudwatch[].
        return {
            ...this.config,
            logging: this.config.cloudwatch[0]?.logging || {
                level: 'info',
                enableConsole: true
            }
        };
    }

    async init() {
        try {
            await this.loadConfig();
            this.logger = new Logger(this.buildLoggerConfig());
            this.logger.info('=== CloudWatch Log Downloader started ===');

            this.authManager = new this.AwsAuthManagerClass(this.config.aws, this.logger);
            await this.authManager.authenticate();

            await this.initProjectRunners();

            this.logger.info('Initialization complete', {
                configFile: path.basename(this.configPath),
                environment: this.config.environment,
                projectCount: this.projectRunners.length,
                projects: this.projectRunners.map(runner => ({
                    project: runner.project,
                    logGroups: runner.cloudWatchClient.logGroups,
                    retentionMinutes: runner.config.files.retentionMinutes,
                    filePrefix: runner.config.files.filePrefix
                })),
                monitorEnabled: this.config.monitor.enabled,
                monitorUrl: this.config.monitor.enabled
                    ? `http://${this.config.monitor.host}:${this.config.monitor.port}`
                    : null
            });

            if (this.config.monitor.enabled) {
                await this.startMonitorServer();
            }

        } catch (error) {
            console.error('Initialization error:', error);
            process.exit(1);
        }
    }

    async initProjectRunners() {
        this.projectRunners = [];

        for (let index = 0; index < this.config.cloudwatch.length; index++) {
            const entry = this.config.cloudwatch[index];
            const runner = new this.ProjectRunnerClass(
                this.config,
                entry,
                this.authManager,
                this.logger
            );
            await runner.init({ skipCredentialTest: index > 0 });
            this.projectRunners.push(runner);
        }
    }

    getMonitorProjectDescriptors() {
        return this.projectRunners.map(runner => {
            const descriptor = runner.getMonitorDescriptor();

            return {
                ...descriptor,
                logDirectoryResolved: path.resolve(runner.config.files.logDirectory),
                logDirectoryDisplay: runner.config.files.logDirectory
            };
        });
    }

    async startMonitorServer() {
        const descriptors = this.getMonitorProjectDescriptors();
        if (descriptors.length === 0) {
            return;
        }

        this.monitorServer = new MonitorServer(
            this.config.monitor,
            this.logger,
            descriptors.map(descriptor => ({
                project: descriptor.project,
                filePrefix: descriptor.filePrefix,
                logDirectory: descriptor.logDirectoryResolved,
                logDirectoryDisplay: descriptor.logDirectoryDisplay,
                configuredLogGroups: descriptor.configuredLogGroups,
                resolvedLogGroups: descriptor.resolvedLogGroups,
                exceptionPatterns: descriptor.exceptionPatterns,
                excludeExceptionPatterns: descriptor.excludeExceptionPatterns
            }))
        );
        await this.monitorServer.start();
    }

    async loadConfig() {
        try {
            if (!await fs.pathExists(this.configPath)) {
                throw new Error(
                    `Configuration file not found: ${this.configPath}. ` +
                    'Copy config.sample.json to config.uat.json or config.prod.json and customize the values.'
                );
            }

            const rawConfig = await fs.readJson(this.configPath);
            this.validateAwsConfig(rawConfig);
            this.config = normalizeConfig(rawConfig);
            this.config.aws = normalizeAwsConfig(this.config);
            this.config.monitor = normalizeMonitorConfig(this.config);

        } catch (error) {
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }

    validateAwsConfig(config) {
        if (!config?.aws?.region) {
            throw new Error('Missing required configuration field: aws.region');
        }
    }

    async downloadAllProjects() {
        await Promise.allSettled(
            this.projectRunners.map(runner => runner.downloadLogs())
        );
    }

    async cleanupAllProjects() {
        await Promise.allSettled(
            this.projectRunners.map(runner => runner.cleanupOldFiles())
        );
    }

    async closeProjectRunners(options = {}) {
        await Promise.allSettled(
            this.projectRunners.map(runner => runner.close(options))
        );
    }

    startScheduledJobs() {
        this.scheduledJobs = this.projectRunners.map(runner => {
            const { downloadInterval, cleanupInterval } = runner.config.schedule;
            const discoveryIntervalMinutes = runner.config.cloudwatch
                .logGroupDiscovery?.refreshIntervalMinutes ?? 10;
            const hasPrefixDiscovery = (runner.config.cloudwatch.logGroups || [])
                .some(entry => entry?.type === 'prefix');
            const downloadJob = this.cron.schedule(downloadInterval, async () => {
                await runner.downloadLogs();
            }, {
                scheduled: true,
                timezone: 'Europe/Rome'
            });

            const cleanupJob = this.cron.schedule(cleanupInterval, async () => {
                await runner.cleanupOldFiles();
            }, {
                scheduled: true,
                timezone: 'Europe/Rome'
            });

            const discoveryJob = hasPrefixDiscovery && discoveryIntervalMinutes > 0
                ? this.cron.schedule(`*/${discoveryIntervalMinutes} * * * *`, async () => {
                    await runner.refreshLogGroupDiscovery();
                }, {
                    scheduled: true,
                    timezone: 'Europe/Rome'
                })
                : null;

            return {
                project: runner.project,
                downloadInterval,
                cleanupInterval,
                discoveryIntervalMinutes: discoveryJob ? discoveryIntervalMinutes : null,
                downloadJob,
                cleanupJob,
                discoveryJob
            };
        });

        this.logger.info('Scheduled jobs started', {
            projects: this.scheduledJobs.map(({
                project,
                downloadInterval,
                cleanupInterval,
                discoveryIntervalMinutes
            }) => ({
                project,
                downloadInterval,
                cleanupInterval,
                discoveryIntervalMinutes
            })),
            credentialRefreshIntervalMinutes: this.config.aws.credentialRefreshIntervalMinutes
        });

        this.startCredentialRefreshJob();
        this.registerShutdownHandlers();
    }

    stopScheduledJobs() {
        for (const job of this.scheduledJobs) {
            job.downloadJob.stop();
            job.cleanupJob.stop();
            job.discoveryJob?.stop();
        }
        this.scheduledJobs = [];
    }

    registerShutdownHandlers() {
        if (this.shutdownHandlersRegistered) {
            return;
        }

        this.shutdownHandlersRegistered = true;

        const shutdown = async () => {
            try {
                this.logger.info('Shutting down service...');
                this.stopScheduledJobs();
                this.stopCredentialRefreshJob();
                await this.closeProjectRunners({ timeoutMs: 15000 });

                if (this.monitorServer) {
                    await this.monitorServer.stop();
                }

                process.exit(0);
            } catch (error) {
                this.logger.error('Shutdown error:', error.message);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => {
            shutdown().catch(error => {
                console.error('Shutdown error:', error);
                process.exit(1);
            });
        });
        process.on('SIGTERM', () => {
            shutdown().catch(error => {
                console.error('Shutdown error:', error);
                process.exit(1);
            });
        });
    }

    startCredentialRefreshJob() {
        const intervalMinutes = this.config.aws.credentialRefreshIntervalMinutes;
        const intervalMs = intervalMinutes * 60 * 1000;

        this.credentialRefreshTimer = setInterval(() => {
            this.authManager.refreshCredentials().catch(error => {
                this.logger.error('AWS credential refresh failed:', {
                    message: error.message
                });
            });
        }, intervalMs);

        this.logger.info('AWS credential refresh scheduled', {
            everyMinutes: intervalMinutes
        });
    }

    stopCredentialRefreshJob() {
        if (this.credentialRefreshTimer) {
            clearInterval(this.credentialRefreshTimer);
            this.credentialRefreshTimer = null;
        }
    }

    printMonitorUrls() {
        if (!this.config.monitor.enabled) {
            return;
        }

        const baseUrl = `http://${this.config.monitor.host}:${this.config.monitor.port}`;
        console.log(`Web console:  ${baseUrl}/`);
        console.log(`REST API:     ${baseUrl}/api/v1`);
    }

    async start() {
        await this.init();
        await this.downloadAllProjects();
        this.startScheduledJobs();
        this.logger.info('Service running. Press Ctrl+C to stop.');
        this.printMonitorUrls();
    }
}

if (require.main === module) {
    const downloader = new CloudWatchLogDownloader();
    downloader.start().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = CloudWatchLogDownloader;
