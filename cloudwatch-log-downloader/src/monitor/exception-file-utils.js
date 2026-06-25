const path = require('path');

const PREVIEW_MAX_LENGTH = 120;
const FILE_ID_PATTERN = /^[\w][\w.-]*$/;

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidFileId(fileId) {
    if (!fileId || typeof fileId !== 'string') {
        return false;
    }

    if (fileId.includes('..') || fileId.includes('/') || fileId.includes('\\')) {
        return false;
    }

    return FILE_ID_PATTERN.test(fileId);
}

function resolveSafeLogPath(logDirectory, filename) {
    if (!filename || filename.includes('\0')) {
        return null;
    }

    const baseDirectory = path.resolve(logDirectory);
    const resolvedPath = path.resolve(baseDirectory, filename);

    if (resolvedPath !== baseDirectory && !resolvedPath.startsWith(`${baseDirectory}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
}

function parseExceptionFilename(filePrefix, filename) {
    const prefix = escapeRegex(filePrefix);
    const match = filename.match(new RegExp(`^${prefix}-exceptions_(.+)\\.log$`));
    if (!match || !isValidFileId(match[1])) {
        return null;
    }

    return {
        type: 'exception',
        timestamp: match[1],
        id: match[1]
    };
}

function parseMainFilename(filePrefix, filename) {
    const prefix = escapeRegex(filePrefix);
    const match = filename.match(new RegExp(`^${prefix}_(.+)\\.log$`));
    if (!match || !isValidFileId(match[1])) {
        return null;
    }

    return {
        type: 'main',
        timestamp: match[1],
        id: match[1]
    };
}

function parseLogFileTimestamp(filePrefix, filename) {
    return parseExceptionFilename(filePrefix, filename)
        || parseMainFilename(filePrefix, filename);
}

function getPairedMainFilename(exceptionFilename, filePrefix) {
    const prefix = `${filePrefix}-exceptions_`;
    if (!exceptionFilename.startsWith(prefix) || !exceptionFilename.endsWith('.log')) {
        return null;
    }

    const suffix = exceptionFilename.slice(prefix.length);
    if (!isValidFileId(suffix.replace(/\.log$/, ''))) {
        return null;
    }

    return `${filePrefix}_${suffix}`;
}

function buildExceptionId(fileId, indexInFile) {
    return `${fileId}:${indexInFile}`;
}

function parseExceptionId(id) {
    if (!id || typeof id !== 'string') {
        return null;
    }

    const separatorIndex = id.lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
        return null;
    }

    const fileId = id.slice(0, separatorIndex);
    const indexInFile = Number.parseInt(id.slice(separatorIndex + 1), 10);

    if (!isValidFileId(fileId) || Number.isNaN(indexInFile) || indexInFile < 1) {
        return null;
    }

    return { fileId, indexInFile };
}

function parseLogLine(line) {
    const trimmed = (line || '').trim();
    const timestampMatch = trimmed.match(/^\[([^\]]+)\]\s+(.*)$/);

    if (!timestampMatch) {
        return {
            timestamp: null,
            source: null,
            body: trimmed,
            preview: buildPreview(trimmed, PREVIEW_MAX_LENGTH)
        };
    }

    let rest = timestampMatch[2];
    const sourceParts = [];
    let sourceMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);

    while (sourceMatch) {
        sourceParts.push(sourceMatch[1]);
        rest = sourceMatch[2];
        sourceMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
    }

    const body = rest.trim();
    return {
        timestamp: timestampMatch[1],
        source: sourceParts.length > 0 ? sourceParts.join(' ') : null,
        body,
        preview: buildPreview(body, PREVIEW_MAX_LENGTH)
    };
}

function buildPreview(text, maxLength = PREVIEW_MAX_LENGTH) {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
}

function findLineInMain(lines, exceptionLine) {
    const target = (exceptionLine || '').trim();
    if (!target) {
        return -1;
    }

    return lines.findIndex(line => line.trim() === target);
}

function isExceptionLogFilename(filePrefix, filename) {
    return parseExceptionFilename(filePrefix, filename) !== null;
}

module.exports = {
    PREVIEW_MAX_LENGTH,
    FILE_ID_PATTERN,
    escapeRegex,
    isValidFileId,
    resolveSafeLogPath,
    parseExceptionFilename,
    parseMainFilename,
    parseLogFileTimestamp,
    getPairedMainFilename,
    buildExceptionId,
    parseExceptionId,
    parseLogLine,
    buildPreview,
    findLineInMain,
    isExceptionLogFilename
};
