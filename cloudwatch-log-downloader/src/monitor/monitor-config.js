const DEFAULT_MONITOR_CONFIG = {
    enabled: true,
    host: '127.0.0.1',
    port: 3847,
    contextLinesBefore: 10,
    contextLinesAfter: 10,
    treeRefreshSeconds: 30,
    maxExceptionFiles: 50
};

function pickNumber(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeMonitorConfig(config) {
    const monitor = config.monitor || {};

    return {
        enabled: monitor.enabled !== false,
        host: monitor.host || DEFAULT_MONITOR_CONFIG.host,
        port: pickNumber(monitor.port, DEFAULT_MONITOR_CONFIG.port),
        contextLinesBefore: pickNumber(monitor.contextLinesBefore, DEFAULT_MONITOR_CONFIG.contextLinesBefore),
        contextLinesAfter: pickNumber(monitor.contextLinesAfter, DEFAULT_MONITOR_CONFIG.contextLinesAfter),
        treeRefreshSeconds: pickNumber(monitor.treeRefreshSeconds, DEFAULT_MONITOR_CONFIG.treeRefreshSeconds),
        maxExceptionFiles: pickNumber(monitor.maxExceptionFiles, DEFAULT_MONITOR_CONFIG.maxExceptionFiles)
    };
}

module.exports = {
    DEFAULT_MONITOR_CONFIG,
    normalizeMonitorConfig,
    pickNumber
};
