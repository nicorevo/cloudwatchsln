const fs = require('fs-extra');
const path = require('path');

const {
    isExceptionLogFilename,
    parseLogLine,
    resolveSafeLogPath
} = require('./exception-file-utils');
const LogFileCache = require('./log-file-cache');

const DEFAULT_TIMEZONE = 'Europe/Rome';
const LAST_HOUR_MS = 60 * 60 * 1000;

function buildLocalDateKey(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
}

function parseValidTimestamp(timestamp) {
    if (!timestamp) {
        return null;
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

class ProjectMetrics {
    constructor(filePrefix, logDirectory) {
        this.filePrefix = filePrefix;
        this.logDirectory = logDirectory;
        this.fileCache = new LogFileCache();
    }

    async calculate(options = {}) {
        const now = options.now ? new Date(options.now) : new Date();
        const timezone = options.timezone || DEFAULT_TIMEZONE;
        const nowTime = now.getTime();
        const lastHourStart = nowTime - LAST_HOUR_MS;
        const todayKey = buildLocalDateKey(now, timezone);
        const entries = await fs.readdir(this.logDirectory);
        const exceptionFiles = entries.filter(filename =>
            isExceptionLogFilename(this.filePrefix, filename)
        );

        let retainedExceptionCount = 0;
        let lastHourExceptionCount = 0;
        let todayExceptionCount = 0;
        let exceptionFileCount = 0;
        let latestException = null;

        for (const filename of exceptionFiles) {
            const filePath = resolveSafeLogPath(this.logDirectory, filename);
            if (!filePath) {
                continue;
            }

            const lines = (await this.fileCache.readLines(filePath))
                .filter(line => line.trim().length > 0);

            if (lines.length > 0) {
                exceptionFileCount += 1;
            }

            retainedExceptionCount += lines.length;

            for (const line of lines) {
                const timestamp = parseValidTimestamp(parseLogLine(line).timestamp);
                if (!timestamp) {
                    continue;
                }

                const timestampTime = timestamp.getTime();
                if (!latestException || timestampTime > latestException.getTime()) {
                    latestException = timestamp;
                }

                if (timestampTime >= lastHourStart && timestampTime <= nowTime) {
                    lastHourExceptionCount += 1;
                }

                if (buildLocalDateKey(timestamp, timezone) === todayKey) {
                    todayExceptionCount += 1;
                }
            }
        }

        return {
            retainedExceptionCount,
            lastHourExceptionCount,
            todayExceptionCount,
            exceptionFileCount,
            latestExceptionAt: latestException ? latestException.toISOString() : null
        };
    }
}

module.exports = ProjectMetrics;
module.exports.DEFAULT_TIMEZONE = DEFAULT_TIMEZONE;
module.exports.LAST_HOUR_MS = LAST_HOUR_MS;
module.exports.buildLocalDateKey = buildLocalDateKey;
module.exports.parseValidTimestamp = parseValidTimestamp;
