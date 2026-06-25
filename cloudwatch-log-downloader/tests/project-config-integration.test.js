const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { normalizeConfig } = require('../src/config-normalizer');
const { normalizeAwsConfig } = require('../src/aws-config');
const { AwsAuthManager } = require('../src/aws-auth-manager');
const CloudWatchClient = require('../src/cloudwatch-client');
const FileManager = require('../src/file-manager');
const { createExceptionMatcher } = require('../src/exception-pattern-matcher');
const { normalizeLogEvent } = require('../src/log-event-normalizer');
const { buildSyntheticProjectConfig } = require('../src/project-runner');

const ENABLED = process.env.RUN_PROJECT_CONFIG_INTEGRATION === '1';
const DEFAULT_LOOKBACK_HOURS = 24;
const SLACK_WEBHOOK_PLACEHOLDER = 'https://hooks.slack.com/services/test/test/test';

function createLogger() {
    return {
        debug() {},
        info() {},
        warn() {},
        error() {}
    };
}

function resolveConfigPath() {
    const configDir = path.join(__dirname, '..');

    if (process.env.CONFIG_FILE) {
        return path.resolve(configDir, process.env.CONFIG_FILE);
    }

    const configEnv = process.env.CONFIG_ENV || 'prod';
    return path.resolve(configDir, `config.${configEnv}.json`);
}

function buildNormalizationEnv(rawConfig) {
    const env = { ...process.env };
    const entries = Array.isArray(rawConfig.cloudwatch)
        ? rawConfig.cloudwatch
        : [rawConfig.cloudwatch].filter(Boolean);

    for (const entry of entries) {
        for (const channel of entry.channels || []) {
            if (channel.webhookUrlEnv && !env[channel.webhookUrlEnv]) {
                env[channel.webhookUrlEnv] = SLACK_WEBHOOK_PLACEHOLDER;
            }
        }
    }

    return env;
}

async function loadRuntimeConfig() {
    const configPath = resolveConfigPath();
    const rawConfig = await fs.readJson(configPath);
    const normalized = normalizeConfig(rawConfig, {
        env: buildNormalizationEnv(rawConfig)
    });

    normalized.aws = normalizeAwsConfig(normalized);
    return { configPath, config: normalized };
}

function shouldIncludeByMonitorPatterns(event, monitorPatterns) {
    if (!monitorPatterns || monitorPatterns.length === 0) {
        return true;
    }

    return monitorPatterns.some(pattern => event.body.includes(pattern));
}

function countConfiguredPrefixEntries(entry) {
    return (entry.logGroups || [])
        .filter(logGroup => logGroup?.type === 'prefix')
        .length;
}

function assertResolvedDiscovery(entry, resolvedLogGroups) {
    for (const logGroup of entry.logGroups || []) {
        if (logGroup?.type === 'complete') {
            assert.ok(
                resolvedLogGroups.includes(logGroup.name),
                `log group completo non risolto per ${entry.project}`
            );
        }

        if (logGroup?.type === 'prefix') {
            assert.ok(
                resolvedLogGroups.some(name => name.startsWith(logGroup.prefix)),
                `prefix senza log group attivi per ${entry.project}: ${logGroup.prefix}`
            );
        }
    }
}

function pickSyntheticExceptionPattern(patterns, excludes) {
    const matcher = createExceptionMatcher(patterns, excludes);

    return (patterns || [])
        .filter(pattern => typeof pattern === 'string' && pattern.length > 0)
        .find(pattern => matcher(`synthetic prefix ${pattern} synthetic suffix`));
}

async function assertFileManagerClassifiesExceptions(projectConfig, liveEvents) {
    const tempDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), `project-config-${projectConfig.project}-`)
    );
    const matcher = createExceptionMatcher(
        projectConfig.cloudwatch.exceptionPatterns,
        projectConfig.cloudwatch.excludeExceptionPatterns
    );
    const liveExceptionCount = liveEvents.filter(event => matcher(event.body)).length;
    const syntheticPattern = pickSyntheticExceptionPattern(
        projectConfig.cloudwatch.exceptionPatterns,
        projectConfig.cloudwatch.excludeExceptionPatterns
    );
    const syntheticEvents = [];

    if ((projectConfig.cloudwatch.exceptionPatterns || []).length > 0) {
        assert.ok(
            syntheticPattern,
            `nessun exceptionPattern produce una eccezione sintetica per ${projectConfig.project}`
        );
        syntheticEvents.push({
            timestamp: Date.now(),
            logGroupName: projectConfig.cloudwatch.logGroups[0]?.name || 'synthetic',
            logStreamName: 'synthetic',
            message: `synthetic prefix ${syntheticPattern} synthetic suffix`
        });
    }

    try {
        const manager = new FileManager({
            ...projectConfig,
            files: {
                ...projectConfig.files,
                logDirectory: tempDirectory
            }
        }, createLogger());
        await manager.writeLogsToFile([
            ...liveEvents.map(event => ({
                ...event,
                message: event.body
            })),
            ...syntheticEvents
        ]);

        const files = await fs.readdir(tempDirectory);
        const exceptionFiles = files.filter(filename =>
            filename.startsWith(`${projectConfig.files.filePrefix}-exceptions_`)
        );
        const exceptionLineCount = exceptionFiles.length === 0
            ? 0
            : (await Promise.all(exceptionFiles.map(async filename => {
                const content = await fs.readFile(path.join(tempDirectory, filename), 'utf8');
                return content.split('\n').filter(Boolean).length;
            }))).reduce((sum, count) => sum + count, 0);

        assert.equal(
            exceptionLineCount,
            liveExceptionCount + syntheticEvents.length,
            `conteggio eccezioni non coerente per ${projectConfig.project}`
        );

        return {
            liveExceptionCount,
            syntheticExceptionCount: syntheticEvents.length
        };
    } finally {
        await fs.remove(tempDirectory);
    }
}

test('config locale: ogni progetto riceve log, risolve discovery e classifica eccezioni', {
    skip: ENABLED ? false : 'set RUN_PROJECT_CONFIG_INTEGRATION=1 per eseguire il test AWS live'
}, async t => {
    const { configPath, config } = await loadRuntimeConfig();
    const lookbackHours = Number.parseInt(
        process.env.PROJECT_CONFIG_LOOKBACK_HOURS || String(DEFAULT_LOOKBACK_HOURS),
        10
    );
    assert.ok(Number.isInteger(lookbackHours) && lookbackHours > 0);

    const logger = createLogger();
    const authManager = new AwsAuthManager(config.aws, logger);
    await authManager.authenticate();

    const endTime = Date.now();
    const startTime = endTime - (lookbackHours * 60 * 60 * 1000);

    t.diagnostic(`config=${path.basename(configPath)} projects=${config.cloudwatch.length} lookbackHours=${lookbackHours}`);

    for (const entry of config.cloudwatch) {
        await t.test(entry.project, async projectTest => {
            const projectConfig = buildSyntheticProjectConfig(config, entry);
            const client = new CloudWatchClient(projectConfig, logger, authManager);

            await client.init({ skipCredentialTest: true });

            assert.ok(
                client.logGroups.length > 0,
                `nessun log group risolto per ${entry.project}`
            );
            assertResolvedDiscovery(entry, client.logGroups);

            const rawEvents = await client.fetchLogsPaginated(startTime, endTime);
            const visibleEvents = rawEvents
                .map(normalizeLogEvent)
                .filter(event => shouldIncludeByMonitorPatterns(
                    event,
                    entry.monitorPatterns
                ));

            assert.ok(
                visibleEvents.length > 0,
                `nessun log recepito per ${entry.project} nelle ultime ${lookbackHours} ore`
            );

            const classification = await assertFileManagerClassifiesExceptions(
                projectConfig,
                visibleEvents
            );

            projectTest.diagnostic(JSON.stringify({
                resolvedLogGroups: client.logGroups.length,
                prefixEntries: countConfiguredPrefixEntries(entry),
                rawEvents: rawEvents.length,
                visibleEvents: visibleEvents.length,
                liveExceptionEvents: classification.liveExceptionCount,
                syntheticExceptionEvents: classification.syntheticExceptionCount
            }));
        });
    }
});
