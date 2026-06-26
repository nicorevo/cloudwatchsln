const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const { parseLogFileTimestamp: parseLogFileTimestampFromUtils } = require('./monitor/exception-file-utils');
const { createExceptionMatcher } = require('./exception-pattern-matcher');
const {
    normalizeLogEvent,
    formatNormalizedLogLine
} = require('./log-event-normalizer');

class FileManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.logDirectory = path.resolve(config.files.logDirectory);
        this.filePrefix = config.files.filePrefix;
        this.retentionMinutes = config.files.retentionMinutes;
        this.preserveExceptionPairs = config.files.preserveExceptionPairs !== false;
        this.isExceptionMessage = createExceptionMatcher(
            config.cloudwatch?.exceptionPatterns,
            config.cloudwatch?.excludeExceptionPatterns
        );

        this.ensureLogDirectory();
    }

    async ensureLogDirectory() {
        try {
            await fs.ensureDir(this.logDirectory);
            this.logger.debug(`Directory log assicurata: ${this.logDirectory}`);
        } catch (error) {
            this.logger.error('Error creating log directory:', error.message);
            throw error;
        }
    }

    getCurrentLogFileName() {
        const timestamp = moment().format('YYYY-MM-DD_HH-mm');
        return `${this.filePrefix}_${timestamp}.log`;
    }

    getCurrentLogFilePath() {
        return path.join(this.logDirectory, this.getCurrentLogFileName());
    }

    /*
    async writeLogsToFile(events) {
        if (!events || events.length === 0) {
            this.logger.debug('No log events to write');
            return;
        }

        try {
            const filePath = this.getCurrentLogFilePath();
            const logLines = events.map(event => {
                const timestamp = new Date(event.timestamp).toISOString();
                const logStreamName = event.logStreamName || 'unknown';
                const message = event.message || '';

                return `[${timestamp}] [${logStreamName}] ${message}`;
            }).join('\n');

            await fs.appendFile(filePath, logLines + '\n');

            this.logger.info(`Wrote ${events.length} logs to file: ${path.basename(filePath)}`);

        } catch (error) {
            this.logger.error('Error writing log file:', {
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }*/

    shouldIncludeLine(message) {
        const patterns = this.config.cloudwatch?.monitorPatterns;
        if (!patterns || patterns.length === 0) {
            return true;
        }
        const text = message || '';
        return patterns.some(pattern => text.includes(pattern));
    }

    matchesExceptionPattern(message) {
        return this.isExceptionMessage(message);
    }

    getExceptionLogFilePath() {
        const timestamp = moment().format('YYYY-MM-DD_HH-mm');
        return path.join(this.logDirectory, `${this.filePrefix}-exceptions_${timestamp}.log`);
    }

    parseLogFileTimestamp(filename) {
        return parseLogFileTimestampFromUtils(this.filePrefix, filename);
    }

    collectProtectedTimestamps(logFiles) {
        const protectedTimestamps = new Set();

        for (const file of logFiles) {
            const parsed = this.parseLogFileTimestamp(file);
            if (parsed?.type === 'exception') {
                protectedTimestamps.add(parsed.timestamp);
            }
        }

        return protectedTimestamps;
    }

    shouldPreserveFile(filename, protectedTimestamps) {
        if (!this.preserveExceptionPairs) {
            return false;
        }

        const parsed = this.parseLogFileTimestamp(filename);
        if (!parsed) {
            return false;
        }

        if (parsed.type === 'exception') {
            return true;
        }

        return protectedTimestamps.has(parsed.timestamp);
    }

    formatEventMessage(event) {
        return normalizeLogEvent(event);
    }

    async writeLogsToFile(events) {
        if (!events || events.length === 0) {
            this.logger.debug('No log events to write');
            return {
                logFileName: null,
                exceptionFileName: null,
                writtenLineCount: 0,
                exceptionLineCount: 0
            };
        }

        try {
            const filePath = this.getCurrentLogFilePath();
            const exceptionFilePath = this.getExceptionLogFilePath();
            const logFileName = path.basename(filePath);
            const exceptionFileName = path.basename(exceptionFilePath);
            const lines = [];
            const exceptionLines = [];

            for (const event of events) {
                const normalized = this.formatEventMessage(event);
                const { body } = normalized;

                if (!this.shouldIncludeLine(body)) {
                    continue;
                }

                const line = formatNormalizedLogLine(normalized);
                lines.push(line);

                if (this.matchesExceptionPattern(body)) {
                    exceptionLines.push(line);
                }
            }

            if (lines.length === 0) {
                this.logger.debug('No lines after monitorPatterns filter');
                return {
                    logFileName,
                    exceptionFileName: null,
                    writtenLineCount: 0,
                    exceptionLineCount: 0
                };
            }

            await fs.appendFile(filePath, lines.join('\n') + '\n');
            this.logger.info(`Wrote ${lines.length} logs to file: ${logFileName}`);

            if (exceptionLines.length > 0) {
                await fs.appendFile(exceptionFilePath, exceptionLines.join('\n') + '\n');
                this.logger.info(`Wrote ${exceptionLines.length} exceptions to: ${exceptionFileName}`);
            }

            return {
                logFileName,
                exceptionFileName: exceptionLines.length > 0 ? exceptionFileName : null,
                writtenLineCount: lines.length,
                exceptionLineCount: exceptionLines.length
            };

        } catch (error) {
            this.logger.error('Error writing log file:', {
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }



    async cleanupOldFiles() {
        try {
            const files = await fs.readdir(this.logDirectory);
            const logFiles = files.filter(file =>
                file.startsWith(this.filePrefix) && file.endsWith('.log')
            );

            const protectedTimestamps = this.collectProtectedTimestamps(logFiles);
            const cutoffTime = moment().subtract(this.retentionMinutes, 'minutes');
            let deletedCount = 0;
            let preservedCount = 0;

            for (const file of logFiles) {
                if (this.shouldPreserveFile(file, protectedTimestamps)) {
                    preservedCount++;
                    continue;
                }

                const filePath = path.join(this.logDirectory, file);
                const stats = await fs.stat(filePath);
                const fileTime = moment(stats.mtime);

                if (fileTime.isBefore(cutoffTime)) {
                    await fs.remove(filePath);
                    deletedCount++;
                    this.logger.debug(`Deleted file: ${file}`);
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`Cleanup complete: deleted ${deletedCount} old files`);
            }

            if (preservedCount > 0) {
                this.logger.info(`Cleanup: preserved ${preservedCount} exception/pair files`);
            }

        } catch (error) {
            this.logger.error('File cleanup error:', error.message);
        }
    }

    async getFileList() {
        try {
            const files = await fs.readdir(this.logDirectory);
            const logFiles = files.filter(file => 
                file.startsWith(this.filePrefix) && file.endsWith('.log')
            );

            const fileDetails = await Promise.all(logFiles.map(async file => {
                const filePath = path.join(this.logDirectory, file);
                const stats = await fs.stat(filePath);
                return {
                    name: file,
                    path: filePath,
                    size: stats.size,
                    created: stats.mtime,
                    age: moment().diff(moment(stats.mtime), 'minutes')
                };
            }));

            return fileDetails.sort((a, b) => b.created - a.created);

        } catch (error) {
            this.logger.error('Error listing files:', error.message);
            return [];
        }
    }
}

module.exports = FileManager;
