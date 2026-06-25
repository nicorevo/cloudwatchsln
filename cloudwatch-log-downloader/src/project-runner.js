const moment = require('moment');

const CloudWatchClient = require('./cloudwatch-client');
const FileManager = require('./file-manager');
const ExceptionNotificationManager = require(
    './notifications/exception-notification-manager'
);

const INITIAL_LOOKBACK_MS = 15 * 60 * 1000;

function buildSyntheticProjectConfig(rootConfig, entry) {
    return {
        environment: rootConfig.environment,
        aws: rootConfig.aws,
        project: entry.project,
        cloudwatch: {
            logGroups: entry.logGroups,
            logGroupDiscovery: entry.logGroupDiscovery,
            filterPattern: entry.filterPattern,
            maxResults: entry.maxResults,
            monitorPatterns: entry.monitorPatterns,
            exceptionPatterns: entry.exceptionPatterns,
            excludeExceptionPatterns: entry.excludeExceptionPatterns
        },
        channels: entry.channels || [],
        schedule: entry.schedule,
        files: entry.files,
        logging: entry.logging
    };
}

function toMonitorLogGroupEntry(entry) {
    if (entry?.type === 'complete') {
        return { type: 'complete', value: entry.name };
    }

    if (entry?.type === 'prefix') {
        return { type: 'prefix', value: entry.prefix };
    }

    if (typeof entry === 'string') {
        return { type: 'complete', value: entry };
    }

    return null;
}

class ProjectRunner {
    constructor(rootConfig, entry, authManager, logger, options = {}) {
        this.project = entry.project;
        this.config = buildSyntheticProjectConfig(rootConfig, entry);
        this.authManager = authManager;
        this.logger = logger;
        this.lastProcessedTime = options.lastProcessedTime ?? (Date.now() - INITIAL_LOOKBACK_MS);

        this.cloudWatchClient = options.cloudWatchClient
            ?? new CloudWatchClient(this.config, logger, authManager);
        this.fileManager = options.fileManager
            ?? new FileManager(this.config, logger);
        const enabledChannels = this.config.channels.filter(
            channel => channel.enabled !== false
        );
        this.notificationManager = options.notificationManager
            ?? (enabledChannels.length > 0
                ? new ExceptionNotificationManager({
                    project: this.project,
                    environment: this.config.environment,
                    filePrefix: this.config.files.filePrefix,
                    logDirectory: this.config.files.logDirectory,
                    monitorPatterns: this.config.cloudwatch.monitorPatterns,
                    exceptionPatterns: this.config.cloudwatch.exceptionPatterns,
                    excludeExceptionPatterns: this.config.cloudwatch.excludeExceptionPatterns,
                    channels: enabledChannels
                }, logger)
                : null);
    }

    async init(options = {}) {
        if (typeof this.cloudWatchClient.init === 'function') {
            await this.cloudWatchClient.init(options);
        }
        if (this.notificationManager) {
            await this.notificationManager.init();
        }
    }

    getMonitorDescriptor() {
        return {
            project: this.project,
            filePrefix: this.config.files.filePrefix,
            logDirectory: this.config.files.logDirectory,
            configuredLogGroups: (this.config.cloudwatch.logGroups || [])
                .map(toMonitorLogGroupEntry)
                .filter(Boolean),
            resolvedLogGroups: [...(this.cloudWatchClient.logGroups || [])],
            exceptionPatterns: [...(this.config.cloudwatch.exceptionPatterns || [])],
            excludeExceptionPatterns: [
                ...(this.config.cloudwatch.excludeExceptionPatterns || [])
            ]
        };
    }

    async downloadLogs() {
        try {
            const endTime = Date.now();
            const startTime = this.lastProcessedTime;

            this.logger.info('Starting log download', {
                project: this.project,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                interval: moment.duration(endTime - startTime).humanize()
            });

            const events = await this.cloudWatchClient.fetchLogsPaginated(startTime, endTime);

            if (events.length > 0) {
                await this.fileManager.writeLogsToFile(events);
                try {
                    this.notificationManager?.ingest(events);
                } catch (error) {
                    this.logger.error('Errore durante la gestione delle notifiche', {
                        project: this.project,
                        message: error.message
                    });
                }
                this.logger.info(`Download complete: ${events.length} events processed`, {
                    project: this.project
                });
            } else {
                this.logger.info('No new logs found for the specified period', {
                    project: this.project
                });
            }

            this.lastProcessedTime = endTime;
        } catch (error) {
            this.logger.error('Error downloading logs:', {
                project: this.project,
                message: error.message,
                stack: error.stack
            });
        }
    }

    async refreshLogGroupDiscovery() {
        if (typeof this.cloudWatchClient.refreshConfiguredLogGroups !== 'function') {
            return null;
        }

        try {
            return await this.cloudWatchClient.refreshConfiguredLogGroups();
        } catch (error) {
            this.logger.error('Errore durante la discovery dei log group CloudWatch', {
                project: this.project,
                message: error.message
            });
            return null;
        }
    }

    async close(options = {}) {
        if (this.notificationManager) {
            await this.notificationManager.close(options);
        }
    }

    async cleanupOldFiles() {
        try {
            this.logger.info('Starting old file cleanup...', { project: this.project });
            await this.fileManager.cleanupOldFiles();

            const files = await this.fileManager.getFileList();
            this.logger.info('Current files:', {
                project: this.project,
                count: files.length,
                totalSize: files.reduce((sum, file) => sum + file.size, 0),
                oldestFile: files.length > 0 ? files[files.length - 1].name : 'none'
            });
        } catch (error) {
            this.logger.error('Cleanup error:', {
                project: this.project,
                message: error.message
            });
        }
    }
}

module.exports = {
    ProjectRunner,
    buildSyntheticProjectConfig,
    INITIAL_LOOKBACK_MS
};
