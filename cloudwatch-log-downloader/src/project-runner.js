const moment = require('moment');

const CloudWatchClient = require('./cloudwatch-client');
const FileManager = require('./file-manager');

const INITIAL_LOOKBACK_MS = 15 * 60 * 1000;

function buildSyntheticProjectConfig(rootConfig, entry) {
    return {
        environment: rootConfig.environment,
        aws: rootConfig.aws,
        project: entry.project,
        cloudwatch: {
            logGroups: entry.logGroups,
            filterPattern: entry.filterPattern,
            maxResults: entry.maxResults,
            monitorPatterns: entry.monitorPatterns,
            exceptionPatterns: entry.exceptionPatterns
        },
        schedule: entry.schedule,
        files: entry.files,
        logging: entry.logging
    };
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
    }

    async init(options = {}) {
        if (typeof this.cloudWatchClient.init === 'function') {
            await this.cloudWatchClient.init(options);
        }
    }

    getMonitorDescriptor() {
        return {
            project: this.project,
            filePrefix: this.config.files.filePrefix,
            logDirectory: this.config.files.logDirectory,
            exceptionPatterns: [...(this.config.cloudwatch.exceptionPatterns || [])]
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
