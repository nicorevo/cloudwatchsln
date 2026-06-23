const fs = require('fs-extra');
const path = require('path');

const {
    parseLogLine,
    parseMainFilename,
    resolveSafeLogPath
} = require('./exception-file-utils');
const { createExceptionMatcher } = require('../exception-pattern-matcher');

const DEFAULT_LIMIT = 200;
const MIN_LIMIT = 20;
const MAX_LIMIT = 1000;
const CURSOR_VERSION = 1;

class TailError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'TailError';
        this.code = code;
    }
}

function normalizeTailLimit(rawLimit) {
    if (rawLimit === null || rawLimit === undefined) {
        return DEFAULT_LIMIT;
    }

    if (!/^\d+$/.test(String(rawLimit))) {
        throw new TailError('INVALID_LIMIT', 'Limite tail non valido');
    }

    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw new TailError('INVALID_LIMIT', 'Limite tail non valido');
    }

    return limit;
}

function encodeCursor(cursor) {
    if (!cursor) {
        return null;
    }

    return Buffer.from(JSON.stringify({
        v: CURSOR_VERSION,
        file: cursor.file,
        line: cursor.line
    })).toString('base64url');
}

function decodeCursor(rawCursor, filePrefix) {
    try {
        const parsed = JSON.parse(
            Buffer.from(rawCursor, 'base64url').toString('utf8')
        );

        if (
            parsed?.v !== CURSOR_VERSION
            || !parseMainFilename(filePrefix, parsed.file)
            || !Number.isInteger(parsed.line)
            || parsed.line < 0
        ) {
            throw new Error('invalid cursor payload');
        }

        return {
            file: parsed.file,
            line: parsed.line
        };
    } catch (error) {
        throw new TailError('INVALID_CURSOR', 'Cursore tail non valido');
    }
}

function splitPhysicalLines(content) {
    const lines = content.split('\n');
    if (content.endsWith('\n')) {
        lines.pop();
    }
    return lines;
}

class ProjectLogTail {
    constructor(options) {
        this.filePrefix = options.filePrefix;
        this.logDirectory = options.logDirectory;
        this.isExceptionMessage = createExceptionMatcher(
            options.exceptionPatterns,
            options.excludeExceptionPatterns
        );
    }

    async read(options = {}) {
        const limit = options.limit ?? DEFAULT_LIMIT;
        const files = await this.listMainFiles();

        if (!options.after) {
            return this.readInitial(files, limit);
        }

        const cursor = decodeCursor(options.after, this.filePrefix);
        return this.readIncremental(files, cursor, limit);
    }

    async listMainFiles() {
        const entries = await fs.readdir(this.logDirectory);
        return entries
            .filter(filename => parseMainFilename(this.filePrefix, filename))
            .sort((left, right) => left.localeCompare(right));
    }

    async readFile(filename) {
        const filePath = resolveSafeLogPath(this.logDirectory, filename);
        if (!filePath) {
            throw new TailError('INVALID_CURSOR', 'Cursore tail non valido');
        }

        const content = await fs.readFile(filePath, 'utf8');
        return splitPhysicalLines(content);
    }

    async readInitial(files, limit) {
        if (files.length === 0) {
            return {
                cursor: null,
                reset: false,
                hasMore: false,
                lines: []
            };
        }

        const collected = [];
        for (let fileIndex = files.length - 1; fileIndex >= 0 && collected.length < limit; fileIndex--) {
            const filename = files[fileIndex];
            const lines = await this.readFile(filename);

            for (let lineIndex = lines.length - 1; lineIndex >= 0 && collected.length < limit; lineIndex--) {
                if (lines[lineIndex].trim().length === 0) {
                    continue;
                }

                collected.push(this.buildLine(filename, lineIndex, lines[lineIndex]));
            }
        }

        const newestFile = files[files.length - 1];
        const newestLines = await this.readFile(newestFile);

        return {
            cursor: encodeCursor({
                file: newestFile,
                line: newestLines.length
            }),
            reset: false,
            hasMore: false,
            lines: collected.reverse()
        };
    }

    async readIncremental(files, cursor, limit) {
        if (files.length === 0 || !files.includes(cursor.file)) {
            return {
                cursor: await this.buildEndCursor(files),
                reset: true,
                hasMore: false,
                lines: []
            };
        }

        const cursorFileLines = await this.readFile(cursor.file);
        if (cursor.line > cursorFileLines.length) {
            return {
                cursor: await this.buildEndCursor(files),
                reset: true,
                hasMore: false,
                lines: []
            };
        }

        const available = [];
        const startFileIndex = files.indexOf(cursor.file);

        for (let fileIndex = startFileIndex; fileIndex < files.length; fileIndex++) {
            const filename = files[fileIndex];
            const lines = fileIndex === startFileIndex
                ? cursorFileLines
                : await this.readFile(filename);
            const startLine = fileIndex === startFileIndex ? cursor.line : 0;

            for (let lineIndex = startLine; lineIndex < lines.length; lineIndex++) {
                if (lines[lineIndex].trim().length === 0) {
                    continue;
                }

                available.push({
                    filename,
                    lineIndex,
                    line: this.buildLine(filename, lineIndex, lines[lineIndex])
                });

                if (available.length > limit) {
                    break;
                }
            }

            if (available.length > limit) {
                break;
            }
        }

        const selected = available.slice(0, limit);
        const hasMore = available.length > selected.length;
        const nextCursor = hasMore
            ? encodeCursor({
                file: selected[selected.length - 1].filename,
                line: selected[selected.length - 1].lineIndex + 1
            })
            : await this.buildEndCursor(files);

        return {
            cursor: nextCursor,
            reset: false,
            hasMore,
            lines: selected.map(entry => entry.line)
        };
    }

    async buildEndCursor(files) {
        if (files.length === 0) {
            return null;
        }

        const filename = files[files.length - 1];
        const lines = await this.readFile(filename);
        return encodeCursor({
            file: filename,
            line: lines.length
        });
    }

    buildLine(filename, lineIndex, raw) {
        const parsed = parseLogLine(raw);
        return {
            id: Buffer.from(JSON.stringify({
                file: filename,
                line: lineIndex
            })).toString('base64url'),
            timestamp: parsed.timestamp,
            source: parsed.source,
            message: parsed.body,
            raw,
            isException: this.isExceptionMessage(parsed.body)
        };
    }
}

module.exports = {
    ProjectLogTail,
    TailError,
    normalizeTailLimit,
    encodeCursor,
    decodeCursor,
    splitPhysicalLines,
    DEFAULT_LIMIT,
    MIN_LIMIT,
    MAX_LIMIT
};
