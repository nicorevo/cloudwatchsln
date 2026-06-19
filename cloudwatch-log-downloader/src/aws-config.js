const { pickNumber } = require('./monitor/monitor-config');

const DEFAULT_AWS_CONFIG = {
    credentialRefreshIntervalMinutes: 55,
    loginOnStartupIfNeeded: false,
    ssoSessionWarningMinutes: 30
};

function pickPositiveNumber(value, defaultValue, minimum = 1) {
    const parsed = pickNumber(value, defaultValue);
    return parsed >= minimum ? parsed : defaultValue;
}

function normalizeAwsConfig(config) {
    const aws = config.aws || {};

    return {
        ...aws,
        region: aws.region,
        profile: aws.profile,
        credentialRefreshIntervalMinutes: pickPositiveNumber(
            aws.credentialRefreshIntervalMinutes,
            DEFAULT_AWS_CONFIG.credentialRefreshIntervalMinutes
        ),
        loginOnStartupIfNeeded: aws.loginOnStartupIfNeeded === true,
        ssoSessionWarningMinutes: pickPositiveNumber(
            aws.ssoSessionWarningMinutes,
            DEFAULT_AWS_CONFIG.ssoSessionWarningMinutes
        )
    };
}

module.exports = {
    DEFAULT_AWS_CONFIG,
    normalizeAwsConfig,
    pickPositiveNumber
};
