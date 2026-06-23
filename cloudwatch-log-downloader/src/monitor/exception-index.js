const fs = require('fs-extra');
const path = require('path');

const {
    parseExceptionFilename,
    buildExceptionId,
    parseLogLine,
    findLineInMain,
    isExceptionLogFilename,
    getPairedMainFilename,
    resolveSafeLogPath
} = require('./exception-file-utils');
const LogFileCache = require('./log-file-cache');
const { createExceptionMatcher } = require('../exception-pattern-matcher');

class ExceptionIndex {
    constructor(config, filePrefix, logDirectory, options = {}) {
        this.config = config;
        this.filePrefix = filePrefix;
        this.logDirectory = logDirectory;
        this.fileCache = new LogFileCache();
        this.isVisibleException = createExceptionMatcher(
            options.exceptionPatterns,
            options.excludeExceptionPatterns,
            { matchWhenUnconfigured: true }
        );
    }

    async buildTree(limit = null) {
        const maxFiles = limit || this.config.maxExceptionFiles;
        const entries = await fs.readdir(this.logDirectory);
        const exceptionFiles = entries
            .filter(name => isExceptionLogFilename(this.filePrefix, name))
            .sort((left, right) => right.localeCompare(left));

        const files = [];

        for (const filename of exceptionFiles) {
            const parsedFilename = parseExceptionFilename(this.filePrefix, filename);
            if (!parsedFilename) {
                continue;
            }

            const filePath = resolveSafeLogPath(this.logDirectory, filename);
            if (!filePath) {
                continue;
            }

            const allLines = await this.fileCache.readLines(filePath);
            const lines = allLines
                .filter(line => line.trim().length > 0)
                .map((line, index) => ({
                    line,
                    indexInFile: index + 1,
                    parsedLine: parseLogLine(line)
                }))
                .filter(entry => this.isVisibleException(entry.parsedLine.body));

            if (lines.length === 0) {
                continue;
            }

            const mainFilename = getPairedMainFilename(filename, this.filePrefix);
            const mainPath = mainFilename
                ? resolveSafeLogPath(this.logDirectory, mainFilename)
                : null;
            const mainExists = mainPath && await fs.pathExists(mainPath);
            const mainLines = mainExists
                ? await this.fileCache.readLines(mainPath)
                : [];

            const exceptions = lines.map(entry => {
                const mainIndex = mainExists
                    ? findLineInMain(mainLines, entry.line)
                    : -1;

                return {
                    id: buildExceptionId(parsedFilename.id, entry.indexInFile),
                    indexInFile: entry.indexInFile,
                    lineNumberInMain: mainIndex === -1 ? null : mainIndex + 1,
                    timestamp: entry.parsedLine.timestamp,
                    preview: entry.parsedLine.preview,
                    source: entry.parsedLine.source
                };
            });

            files.push({
                id: parsedFilename.id,
                filename,
                mainFilename,
                exceptionCount: exceptions.length,
                exceptions
            });

            if (files.length >= maxFiles) {
                break;
            }
        }

        return {
            generatedAt: new Date().toISOString(),
            files
        };
    }

    async countExceptionFiles() {
        const entries = await fs.readdir(this.logDirectory);
        let count = 0;

        for (const filename of entries) {
            if (!isExceptionLogFilename(this.filePrefix, filename)) {
                continue;
            }

            const filePath = resolveSafeLogPath(this.logDirectory, filename);
            if (!filePath) {
                continue;
            }

            const lines = await this.fileCache.readLines(filePath);
            if (lines.some(line => {
                if (!line.trim()) {
                    return false;
                }
                return this.isVisibleException(parseLogLine(line).body);
            })) {
                count += 1;
            }
        }

        return count;
    }
}

module.exports = ExceptionIndex;
