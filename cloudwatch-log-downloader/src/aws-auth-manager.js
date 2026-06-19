const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { fromSSO, fromIni } = require('@aws-sdk/credential-providers');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

function isTokenError(error) {
    if (!error) {
        return false;
    }

    const name = error.name || '';
    const message = error.message || '';

    return name === 'TokenRefreshRequired'
        || name === 'CredentialsProviderError'
        || message.includes('token')
        || message.includes('Token')
        || message.includes('expired')
        || message.includes('scadut');
}

function buildSsoExpiredError(profile) {
    return new Error(`SSO token expired. Run: aws sso login --profile ${profile}`);
}

function parseIniSections(content) {
    const sections = new Map();
    let currentName = null;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) {
            continue;
        }

        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentName = sectionMatch[1].trim();
            sections.set(currentName, {});
            continue;
        }

        if (!currentName) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        sections.get(currentName)[key] = value;
    }

    return sections;
}

function resolveProfileStartUrl(sections, profileName) {
    const profileSection = sections.get(`profile ${profileName}`) || sections.get(profileName);
    if (!profileSection) {
        return null;
    }

    if (profileSection.sso_start_url) {
        return profileSection.sso_start_url;
    }

    const sessionName = profileSection.sso_session;
    if (!sessionName) {
        return null;
    }

    const sessionSection = sections.get(`sso-session ${sessionName}`);
    return sessionSection?.sso_start_url || null;
}

async function readSsoCacheEntries(cacheDirectory) {
    if (!await fs.pathExists(cacheDirectory)) {
        return [];
    }

    const files = await fs.readdir(cacheDirectory);
    const entries = [];

    for (const filename of files) {
        if (!filename.endsWith('.json')) {
            continue;
        }

        try {
            const content = await fs.readJson(path.join(cacheDirectory, filename));
            if (content && content.expiresAt) {
                entries.push(content);
            }
        } catch {
            // Ignore invalid cache files
        }
    }

    return entries;
}

async function getSsoSessionExpiry(profileName, options = {}) {
    const homeDirectory = options.homeDirectory || os.homedir();
    const configPath = options.awsConfigPath || path.join(homeDirectory, '.aws', 'config');
    const cacheDirectory = options.ssoCacheDirectory || path.join(homeDirectory, '.aws', 'sso', 'cache');

    if (!await fs.pathExists(configPath)) {
        return null;
    }

    const configContent = await fs.readFile(configPath, 'utf8');
    const sections = parseIniSections(configContent);
    const startUrl = resolveProfileStartUrl(sections, profileName);

    if (!startUrl) {
        return null;
    }

    const cacheEntries = await readSsoCacheEntries(cacheDirectory);
    const matchingEntries = cacheEntries
        .filter(entry => entry.startUrl === startUrl)
        .map(entry => new Date(entry.expiresAt))
        .filter(date => !Number.isNaN(date.getTime()))
        .sort((left, right) => right.getTime() - left.getTime());

    return matchingEntries[0] || null;
}

function runAwsSsoLogin(profileName) {
    return new Promise((resolve, reject) => {
        const child = spawn('aws', ['sso', 'login', '--profile', profileName], {
            stdio: 'inherit'
        });

        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`SSO login failed (exit code ${code})`));
        });
    });
}

class AwsAuthManager {
    constructor(awsConfig, logger, options = {}) {
        this.awsConfig = awsConfig;
        this.logger = logger;
        this.profile = awsConfig.profile;
        this.region = awsConfig.region;
        this.credentialProvider = null;
        this.lastCredentials = null;
        this.lastIdentity = null;
        this.authenticated = false;
        this.createCredentialProviderFn = options.createCredentialProvider || this.createDefaultCredentialProvider.bind(this);
        this.verifyIdentityFn = options.verifyIdentity || this.verifyIdentityWithSts.bind(this);
        this.getSsoSessionExpiryFn = options.getSsoSessionExpiry || getSsoSessionExpiry;
        this.runLoginFn = options.runLogin || runAwsSsoLogin;
    }

    createDefaultCredentialProvider() {
        if (!this.profile) {
            return null;
        }

        try {
            return fromSSO({ profile: this.profile });
        } catch (error) {
            this.logger.warn('SSO unavailable, falling back to fromIni:', error.message);
            return fromIni({ profile: this.profile });
        }
    }

    async verifyIdentityWithSts(credentials) {
        const stsClient = new STSClient({
            region: this.region,
            credentials
        });

        return stsClient.send(new GetCallerIdentityCommand({}));
    }

    async loginIfNeeded() {
        if (!this.awsConfig.loginOnStartupIfNeeded || !this.profile) {
            return false;
        }

        this.logger.info(`Starting SSO login for profile ${this.profile}...`);
        await this.runLoginFn(this.profile);
        return true;
    }

    async authenticate() {
        if (this.awsConfig.loginOnStartupIfNeeded) {
            const currentExpiry = await this.getSsoSessionExpiryFn(this.profile);
            if (!currentExpiry || currentExpiry.getTime() <= Date.now()) {
                await this.loginIfNeeded();
            }
        }

        this.credentialProvider = this.createCredentialProviderFn();
        if (!this.credentialProvider) {
            throw new Error('AWS profile not configured');
        }

        try {
            this.lastCredentials = await this.credentialProvider();
            this.lastIdentity = await this.verifyIdentityFn(this.lastCredentials);
        } catch (error) {
            if (isTokenError(error)) {
                throw buildSsoExpiredError(this.profile);
            }

            throw error;
        }

        this.authenticated = true;

        const ssoSessionExpiresAt = await this.getSsoSessionExpiryFn(this.profile);
        const result = {
            profile: this.profile,
            account: this.lastIdentity.Account,
            arn: this.lastIdentity.Arn,
            credentialExpiration: this.lastCredentials.expiration || null,
            ssoSessionExpiresAt
        };

        this.logger.info('AWS authentication complete', {
            profile: result.profile,
            account: result.account,
            credentialExpiration: result.credentialExpiration
                ? result.credentialExpiration.toISOString()
                : null,
            ssoSessionExpiresAt: result.ssoSessionExpiresAt
                ? result.ssoSessionExpiresAt.toISOString()
                : null
        });

        if (result.ssoSessionExpiresAt) {
            const warningMinutes = this.awsConfig.ssoSessionWarningMinutes;
            const minutesRemaining = (result.ssoSessionExpiresAt.getTime() - Date.now()) / 60000;

            if (minutesRemaining <= warningMinutes) {
                this.logger.warn('SSO session expiring soon', {
                    ssoSessionExpiresAt: result.ssoSessionExpiresAt.toISOString(),
                    minutesRemaining: Math.max(0, Math.round(minutesRemaining)),
                    hint: `aws sso login --profile ${this.profile}`
                });
            }
        }

        return result;
    }

    async refreshCredentials() {
        if (!this.credentialProvider) {
            throw new Error('AWS authentication not initialized');
        }

        try {
            this.lastCredentials = await this.credentialProvider();
            this.logger.info('AWS credentials refreshed', {
                profile: this.profile,
                expiration: this.lastCredentials.expiration
                    ? this.lastCredentials.expiration.toISOString()
                    : null
            });

            return this.lastCredentials;
        } catch (error) {
            this.authenticated = false;

            if (isTokenError(error)) {
                throw buildSsoExpiredError(this.profile);
            }

            throw error;
        }
    }

    getCredentialProvider() {
        return this.credentialProvider;
    }

    isAuthenticated() {
        return this.authenticated;
    }
}

module.exports = {
    AwsAuthManager,
    buildSsoExpiredError,
    getSsoSessionExpiry,
    isTokenError,
    parseIniSections,
    readSsoCacheEntries,
    resolveProfileStartUrl,
    runAwsSsoLogin
};
