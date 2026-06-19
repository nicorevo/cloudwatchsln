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

class ExceptionIndex {
    constructor(config, filePrefix, logDirectory) {
        this.config = config;
        this.filePrefix = filePrefix;
        this.logDirectory = logDirectory;
        this.fileCache = new LogFileCache();
    }

    async buildTree(limit = null) {
        const maxFiles = limit || this.config.maxExceptionFiles;
        const entries = await fs.readdir(this.logDirectory);
        const exceptionFiles = entries
            .filter(name => isExceptionLogFilename(this.filePrefix, name))
            .sort((left, right) => right.localeCompare(left))
            .slice(0, maxFiles);

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
            const lines = allLines.filter(line => line.trim().length > 0);

            const mainFilename = getPairedMainFilename(filename, this.filePrefix);
            const mainPath = mainFilename
                ? resolveSafeLogPath(this.logDirectory, mainFilename)
                : null;
            const mainExists = mainPath && await fs.pathExists(mainPath);
            const mainLines = mainExists
                ? await this.fileCache.readLines(mainPath)
                : [];

            const exceptions = lines.map((line, index) => {
                const parsedLine = parseLogLine(line);
                const mainIndex = mainExists ? findLineInMain(mainLines, line) : -1;

                return {
                    id: buildExceptionId(parsedFilename.id, index + 1),
                    indexInFile: index + 1,
                    lineNumberInMain: mainIndex === -1 ? null : mainIndex + 1,
                    timestamp: parsedLine.timestamp,
                    preview: parsedLine.preview,
                    source: parsedLine.source
                };
            });

            files.push({
                id: parsedFilename.id,
                filename,
                mainFilename,
                exceptionCount: exceptions.length,
                exceptions
            });
        }

        return {
            generatedAt: new Date().toISOString(),
            files
        };
    }

    async countExceptionFiles() {
        const entries = await fs.readdir(this.logDirectory);
        return entries.filter(name => isExceptionLogFilename(this.filePrefix, name)).length;
    }
}

module.exports = ExceptionIndex;
