const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const DEFAULT_SCHEDULE = {
    downloadInterval: '*/1 * * * *',
    cleanupInterval: '*/60 * * * *'
};

const DEFAULT_FILES = {
    logDirectory: './logs',
    retentionMinutes: 60,
    preserveExceptionPairs: true
};

const DEFAULT_LOGGING = {
    level: 'info',
    enableConsole: true
};

const DEFAULT_CLOUDWATCH_FIELDS = {
    filterPattern: '',
    maxResults: 100000,
    monitorPatterns: [],
    exceptionPatterns: []
};

function isLegacyCloudwatchConfig(config) {
    return config.cloudwatch
        && typeof config.cloudwatch === 'object'
        && !Array.isArray(config.cloudwatch);
}

function resolveLogGroups(source) {
    if (Array.isArray(source.logGroups) && source.logGroups.length > 0) {
        return source.logGroups.filter(Boolean);
    }

    if (source.logGroupName) {
        return [source.logGroupName];
    }

    return [];
}

function normalizeSchedule(schedule = {}) {
    return {
        downloadInterval: schedule.downloadInterval || DEFAULT_SCHEDULE.downloadInterval,
        cleanupInterval: schedule.cleanupInterval || DEFAULT_SCHEDULE.cleanupInterval
    };
}

function normalizeFiles(files = {}) {
    return {
        logDirectory: files.logDirectory || DEFAULT_FILES.logDirectory,
        retentionMinutes: files.retentionMinutes ?? DEFAULT_FILES.retentionMinutes,
        filePrefix: files.filePrefix,
        preserveExceptionPairs: files.preserveExceptionPairs !== false
    };
}

function normalizeLogging(logging = {}) {
    const rawLevel = logging.level || DEFAULT_LOGGING.level;

    return {
        level: typeof rawLevel === 'string' ? rawLevel.toLowerCase() : DEFAULT_LOGGING.level,
        enableConsole: logging.enableConsole !== false
    };
}

function normalizeCloudwatchFields(source = {}) {
    return {
        logGroups: resolveLogGroups(source),
        filterPattern: source.filterPattern ?? DEFAULT_CLOUDWATCH_FIELDS.filterPattern,
        maxResults: source.maxResults ?? DEFAULT_CLOUDWATCH_FIELDS.maxResults,
        monitorPatterns: Array.isArray(source.monitorPatterns)
            ? source.monitorPatterns
            : DEFAULT_CLOUDWATCH_FIELDS.monitorPatterns,
        exceptionPatterns: Array.isArray(source.exceptionPatterns)
            ? source.exceptionPatterns
            : DEFAULT_CLOUDWATCH_FIELDS.exceptionPatterns
    };
}

function migrateLegacyConfig(config) {
    if (!config.project) {
        throw new Error('Config legacy: campo project mancante a livello root');
    }

    return [{
        project: config.project,
        ...normalizeCloudwatchFields(config.cloudwatch),
        schedule: config.schedule,
        files: config.files,
        logging: config.logging
    }];
}

function validateProjectId(project) {
    if (!project || typeof project !== 'string') {
        throw new Error('project mancante o non valido in cloudwatch[]');
    }

    if (!PROJECT_ID_PATTERN.test(project)) {
        throw new Error(`project non valido: ${project}. Usa slug kebab-case (es. prj01)`);
    }
}

function normalizeCloudwatchEntry(rawEntry) {
    validateProjectId(rawEntry.project);

    const files = normalizeFiles(rawEntry.files);
    if (!files.filePrefix) {
        throw new Error(`files.filePrefix obbligatorio per progetto ${rawEntry.project}`);
    }

    const cloudwatchFields = normalizeCloudwatchFields(rawEntry);
    if (cloudwatchFields.logGroups.length === 0) {
        throw new Error(`logGroups[] obbligatorio per progetto ${rawEntry.project}`);
    }

    return {
        project: rawEntry.project,
        ...cloudwatchFields,
        schedule: normalizeSchedule(rawEntry.schedule),
        files,
        logging: normalizeLogging(rawEntry.logging)
    };
}

function normalizeCloudwatchEntries(config) {
    let rawEntries;

    if (isLegacyCloudwatchConfig(config)) {
        rawEntries = migrateLegacyConfig(config);
    } else if (Array.isArray(config.cloudwatch)) {
        rawEntries = config.cloudwatch;
    } else {
        rawEntries = [];
    }

    if (rawEntries.length === 0) {
        throw new Error('cloudwatch deve contenere almeno un progetto');
    }

    const seenProjects = new Set();
    const seenFilePrefixes = new Set();
    const normalizedEntries = rawEntries.map(entry => {
        const normalized = normalizeCloudwatchEntry(entry);

        if (seenProjects.has(normalized.project)) {
            throw new Error(`project duplicato: ${normalized.project}`);
        }

        if (seenFilePrefixes.has(normalized.files.filePrefix)) {
            throw new Error(`filePrefix duplicato: ${normalized.files.filePrefix}`);
        }

        seenProjects.add(normalized.project);
        seenFilePrefixes.add(normalized.files.filePrefix);
        return normalized;
    });

    return normalizedEntries;
}

function normalizeConfig(rawConfig) {
    const config = rawConfig || {};

    return {
        environment: config.environment,
        aws: config.aws,
        monitor: config.monitor,
        cloudwatch: normalizeCloudwatchEntries(config)
    };
}

module.exports = {
    PROJECT_ID_PATTERN,
    DEFAULT_SCHEDULE,
    DEFAULT_FILES,
    DEFAULT_LOGGING,
    DEFAULT_CLOUDWATCH_FIELDS,
    normalizeConfig,
    normalizeCloudwatchEntries,
    isLegacyCloudwatchConfig
};
