const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

const Logger = require('./logger');
const CloudWatchClient = require('./cloudwatch-client');
const FileManager = require('./file-manager');
const MonitorServer = require('./monitor/monitor-server');
const { AwsAuthManager } = require('./aws-auth-manager');
const { normalizeAwsConfig } = require('./aws-config');
const { normalizeMonitorConfig } = require('./monitor/monitor-config');

class CloudWatchLogDownloader {
    constructor() {
        this.configPath = this.resolveConfigPath();
        this.config = null;
        this.logger = null;
        this.cloudWatchClient = null;
        this.authManager = null;
        this.fileManager = null;
        this.monitorServer = null;
        this.lastProcessedTime = null;
        this.downloadJob = null;
        this.cleanupJob = null;
        this.credentialRefreshTimer = null;
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

    async init() {
        try {
            await this.loadConfig();
            this.logger = new Logger(this.config);
            this.logger.info('=== CloudWatch Log Downloader started ===');

            this.authManager = new AwsAuthManager(this.config.aws, this.logger);
            await this.authManager.authenticate();

            this.cloudWatchClient = new CloudWatchClient(this.config, this.logger, this.authManager);
            await this.cloudWatchClient.init();
            this.fileManager = new FileManager(this.config, this.logger);

            this.lastProcessedTime = Date.now() - (15 * 60 * 1000); // 15 minutes ago

            this.logger.info('Initialization complete', {
                configFile: path.basename(this.configPath),
                environment: this.config.environment,
                project: this.config.project,
                logGroups: this.cloudWatchClient.logGroups,
                retentionMinutes: this.config.files.retentionMinutes,
                monitorEnabled: this.config.monitor.enabled,
                monitorUrl: this.config.monitor.enabled
                    ? `http://${this.config.monitor.host}:${this.config.monitor.port}`
                    : null
            });

            if (this.config.monitor.enabled) {
                this.monitorServer = new MonitorServer(
                    this.config.monitor,
                    this.logger,
                    this.config.files.filePrefix,
                    path.resolve(this.config.files.logDirectory),
                    this.config.files.logDirectory
                );
                await this.monitorServer.start();
            }

        } catch (error) {
            console.error('Initialization error:', error);
            process.exit(1);
        }
    }

    async loadConfig() {
        try {
            if (!await fs.pathExists(this.configPath)) {
                throw new Error(
                    `Configuration file not found: ${this.configPath}. ` +
                    'Copy config.sample.json to config.uat.json or config.prod.json and customize the values.'
                );
            }

            this.config = await fs.readJson(this.configPath);
            this.validateConfig();
            this.config.aws = normalizeAwsConfig(this.config);
            this.config.monitor = normalizeMonitorConfig(this.config);

        } catch (error) {
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }

    validateConfig() {
        const required = ['aws.region', 'files.logDirectory'];

        for (const field of required) {
            const keys = field.split('.');
            let value = this.config;

            for (const key of keys) {
                value = value[key];
                if (value === undefined) {
                    throw new Error(`Missing required configuration field: ${field}`);
                }
            }
        }

        const { logGroups, logGroupName } = this.config.cloudwatch || {};
        const hasLogGroups = Array.isArray(logGroups) && logGroups.length > 0;
        if (!hasLogGroups && !logGroupName) {
            throw new Error('Invalid CloudWatch configuration: set cloudwatch.logGroups[] or cloudwatch.logGroupName');
        }
    }

    async downloadLogs() {
        try {
            const endTime = Date.now();
            const startTime = this.lastProcessedTime;

            this.logger.info('Starting log download', {
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                interval: moment.duration(endTime - startTime).humanize()
            });

            const events = await this.cloudWatchClient.fetchLogsPaginated(startTime, endTime);

            if (events.length > 0) {
                await this.fileManager.writeLogsToFile(events);
                this.logger.info(`Download complete: ${events.length} events processed`);
            } else {
                this.logger.info('No new logs found for the specified period');
            }

            this.lastProcessedTime = endTime;

        } catch (error) {
            this.logger.error('Error downloading logs:', {
                message: error.message,
                stack: error.stack
            });
        }
    }

    async cleanupOldFiles() {
        try {
            this.logger.info('Starting old file cleanup...');
            await this.fileManager.cleanupOldFiles();

            const files = await this.fileManager.getFileList();
            this.logger.info('Current files:', {
                count: files.length,
                totalSize: files.reduce((sum, f) => sum + f.size, 0),
                oldestFile: files.length > 0 ? files[files.length - 1].name : 'none'
            });

        } catch (error) {
            this.logger.error('Cleanup error:', error.message);
        }
    }

    startScheduledJobs() {
        this.downloadJob = cron.schedule(this.config.schedule.downloadInterval, async () => {
            await this.downloadLogs();
        }, {
            scheduled: true,
            timezone: 'Europe/Rome'
        });

        this.cleanupJob = cron.schedule(this.config.schedule.cleanupInterval, async () => {
            await this.cleanupOldFiles();
        }, {
            scheduled: true,
            timezone: 'Europe/Rome'
        });

        this.logger.info('Scheduled jobs started', {
            downloadInterval: this.config.schedule.downloadInterval,
            cleanupInterval: this.config.schedule.cleanupInterval,
            credentialRefreshIntervalMinutes: this.config.aws.credentialRefreshIntervalMinutes
        });

        this.startCredentialRefreshJob();

        const shutdown = async () => {
            try {
                this.logger.info('Shutting down service...');
                this.downloadJob.stop();
                this.cleanupJob.stop();
                this.stopCredentialRefreshJob();

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
        await this.downloadLogs();
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