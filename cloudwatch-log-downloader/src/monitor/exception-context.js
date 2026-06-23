const fs = require('fs-extra');
const path = require('path');

const {
    getPairedMainFilename,
    parseExceptionId,
    parseLogLine,
    findLineInMain,
    resolveSafeLogPath
} = require('./exception-file-utils');
const LogFileCache = require('./log-file-cache');
const { createExceptionMatcher } = require('../exception-pattern-matcher');

class ExceptionContext {
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

    getExceptionFilename(fileId) {
        return `${this.filePrefix}-exceptions_${fileId}.log`;
    }

    async resolveExceptionContext(exceptionId) {
        const parsedId = parseExceptionId(exceptionId);
        if (!parsedId) {
            const error = new Error('Invalid exception ID');
            error.code = 'INVALID_ID';
            throw error;
        }

        const exceptionFilename = this.getExceptionFilename(parsedId.fileId);
        const exceptionPath = resolveSafeLogPath(this.logDirectory, exceptionFilename);

        if (!exceptionPath || !await fs.pathExists(exceptionPath)) {
            const error = new Error('Exception file not found');
            error.code = 'NOT_FOUND';
            throw error;
        }

        const allLines = await this.fileCache.readLines(exceptionPath);
        const exceptionLines = allLines.filter(line => line.trim().length > 0);

        const lineIndex = parsedId.indexInFile - 1;
        if (lineIndex < 0 || lineIndex >= exceptionLines.length) {
            const error = new Error('Exception not found in file');
            error.code = 'NOT_FOUND';
            throw error;
        }

        const exceptionLine = exceptionLines[lineIndex];
        const parsedLine = parseLogLine(exceptionLine);
        if (!this.isVisibleException(parsedLine.body)) {
            const error = new Error('Exception not found in file');
            error.code = 'NOT_FOUND';
            throw error;
        }

        const mainFilename = getPairedMainFilename(exceptionFilename, this.filePrefix);
        const mainPath = mainFilename
            ? resolveSafeLogPath(this.logDirectory, mainFilename)
            : null;
        const contextBefore = this.config.contextLinesBefore;
        const contextAfter = this.config.contextLinesAfter;

        const response = {
            id: exceptionId,
            exception: {
                line: exceptionLine,
                timestamp: parsedLine.timestamp,
                source: parsedLine.source,
                lineNumberInExceptionFile: parsedId.indexInFile,
                lineNumberInMain: null
            },
            context: {
                before: [],
                after: [],
                contextLinesBefore: contextBefore,
                contextLinesAfter: contextAfter
            },
            files: {
                exceptionFile: exceptionFilename,
                mainFile: mainFilename
            }
        };

        if (!mainPath || !await fs.pathExists(mainPath)) {
            response.warning = 'main_file_missing';
            return response;
        }

        const mainLines = await this.fileCache.readLines(mainPath);
        const mainIndex = findLineInMain(mainLines, exceptionLine);

        if (mainIndex === -1) {
            response.warning = 'main_line_not_found';
            return response;
        }

        response.exception.lineNumberInMain = mainIndex + 1;
        response.context.before = this.buildContextSlice(mainLines, mainIndex - contextBefore, mainIndex - 1);
        response.context.after = this.buildContextSlice(mainLines, mainIndex + 1, mainIndex + contextAfter);

        return response;
    }

    buildContextSlice(lines, startIndex, endIndex) {
        const slice = [];

        for (let index = Math.max(0, startIndex); index <= Math.min(lines.length - 1, endIndex); index += 1) {
            const text = lines[index];
            if (!text || !text.trim()) {
                continue;
            }

            slice.push({
                lineNumber: index + 1,
                text
            });
        }

        return slice;
    }
}

module.exports = ExceptionContext;
