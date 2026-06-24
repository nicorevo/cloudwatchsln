const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CHANNEL_ID_PATTERN = PROJECT_ID_PATTERN;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

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
    exceptionPatterns: [],
    excludeExceptionPatterns: []
};

function isLegacyCloudwatchConfig(config) {
    return config.cloudwatch
        && typeof config.cloudwatch === 'object'
        && !Array.isArray(config.cloudwatch);
}

function normalizeLogGroupEntry(entry, project) {
    if (typeof entry === 'string') {
        const name = entry.trim();
        if (name) {
            return { type: 'complete', name };
        }
    }

    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const hasType = Object.prototype.hasOwnProperty.call(entry, 'type');
        const hasComplete = Object.prototype.hasOwnProperty.call(entry, 'complete');
        const hasPrefix = Object.prototype.hasOwnProperty.call(entry, 'prefix');

        if (!hasType && hasComplete !== hasPrefix) {
            if (hasComplete && typeof entry.complete === 'string') {
                const name = entry.complete.trim();
                if (name) {
                    return { type: 'complete', name };
                }
            }

            if (hasPrefix && typeof entry.prefix === 'string') {
                const prefix = entry.prefix.trim();
                if (prefix) {
                    return { type: 'prefix', prefix };
                }
            }
        }
    }

    throw new Error(`logGroups[] contiene un entry non valido per progetto ${project}`);
}

function resolveLogGroups(source, project = 'unknown') {
    if (Array.isArray(source.logGroups) && source.logGroups.length > 0) {
        return source.logGroups.map(entry => normalizeLogGroupEntry(entry, project));
    }

    if (source.logGroupName) {
        return [normalizeLogGroupEntry(source.logGroupName, project)];
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
        logGroups: resolveLogGroups(source, source.project),
        filterPattern: source.filterPattern ?? DEFAULT_CLOUDWATCH_FIELDS.filterPattern,
        maxResults: source.maxResults ?? DEFAULT_CLOUDWATCH_FIELDS.maxResults,
        monitorPatterns: Array.isArray(source.monitorPatterns)
            ? source.monitorPatterns
            : DEFAULT_CLOUDWATCH_FIELDS.monitorPatterns,
        exceptionPatterns: Array.isArray(source.exceptionPatterns)
            ? [...source.exceptionPatterns]
            : [],
        excludeExceptionPatterns: Array.isArray(source.excludeExceptionPatterns)
            ? [...source.excludeExceptionPatterns]
            : []
    };
}

function validateSlackWebhook(channel, project, env) {
    if (!ENV_NAME_PATTERN.test(channel.webhookUrlEnv || '')) {
        throw new Error(
            `webhookUrlEnv non valido per channel ${channel.id} del progetto ${project}`
        );
    }

    if (channel.enabled === false) {
        return;
    }

    const webhookUrl = env[channel.webhookUrlEnv];
    if (!webhookUrl) {
        throw new Error(
            `variabile ambiente ${channel.webhookUrlEnv} mancante per channel ${channel.id}`
        );
    }

    try {
        const parsed = new URL(webhookUrl);
        if (
            parsed.protocol !== 'https:'
            || parsed.hostname !== 'hooks.slack.com'
            || !parsed.pathname.startsWith('/services/')
        ) {
            throw new Error('invalid Slack webhook');
        }
    } catch (error) {
        throw new Error(
            `webhook Slack non valido per channel ${channel.id} del progetto ${project}`
        );
    }
}

function normalizeChannels(channels, project, env = process.env) {
    if (channels === undefined) {
        return [];
    }

    if (!Array.isArray(channels)) {
        throw new Error(`channels deve essere un array per progetto ${project}`);
    }

    const seenIds = new Set();
    return channels.map(channel => {
        const id = channel?.id;
        if (!CHANNEL_ID_PATTERN.test(id || '')) {
            throw new Error(`channel id non valido per progetto ${project}: ${id || 'mancante'}`);
        }
        if (seenIds.has(id)) {
            throw new Error(`channel id duplicato per progetto ${project}: ${id}`);
        }
        seenIds.add(id);

        if (channel.type !== 'slack') {
            throw new Error(
                `tipo channel non supportato per ${id} del progetto ${project}: ${channel.type}`
            );
        }
        if (channel.enabled !== undefined && typeof channel.enabled !== 'boolean') {
            throw new Error(
                `enabled deve essere boolean per channel ${id} del progetto ${project}`
            );
        }

        const normalized = {
            id,
            type: channel.type,
            enabled: channel.enabled !== false,
            webhookUrlEnv: channel.webhookUrlEnv
        };
        validateSlackWebhook(normalized, project, env);
        return normalized;
    });
}

function migrateLegacyConfig(config) {
    if (!config.project) {
        throw new Error('Config legacy: campo project mancante a livello root');
    }

    return [{
        project: config.project,
        ...config.cloudwatch,
        channels: config.cloudwatch.channels,
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

function normalizeCloudwatchEntry(rawEntry, options = {}) {
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
        channels: normalizeChannels(
            rawEntry.channels,
            rawEntry.project,
            options.env ?? process.env
        ),
        schedule: normalizeSchedule(rawEntry.schedule),
        files,
        logging: normalizeLogging(rawEntry.logging)
    };
}

function normalizeCloudwatchEntries(config, options = {}) {
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
        const normalized = normalizeCloudwatchEntry(entry, options);

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

function normalizeConfig(rawConfig, options = {}) {
    const config = rawConfig || {};

    return {
        environment: config.environment,
        aws: config.aws,
        monitor: config.monitor,
        cloudwatch: normalizeCloudwatchEntries(config, options)
    };
}

module.exports = {
    PROJECT_ID_PATTERN,
    CHANNEL_ID_PATTERN,
    ENV_NAME_PATTERN,
    DEFAULT_SCHEDULE,
    DEFAULT_FILES,
    DEFAULT_LOGGING,
    DEFAULT_CLOUDWATCH_FIELDS,
    normalizeConfig,
    normalizeCloudwatchEntries,
    normalizeChannels,
    isLegacyCloudwatchConfig
};
