const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { buildSsoExpiredError, isTokenError } = require('./aws-auth-manager');

class CloudWatchClient {
    constructor(config, logger, authManager) {
        this.config = config;
        this.logger = logger;
        this.authManager = authManager;
        this.logGroups = this.resolveLogGroups();
        this.usesLegacyPodKeywords = this.logGroups.length === 1
            && !!this.config.cloudwatch.logGroupName
            && !this.config.cloudwatch.logGroups?.length
            && Array.isArray(this.config.cloudwatch.podKeywords)
            && this.config.cloudwatch.podKeywords.length > 0;
        this.client = null;
        this.initialized = false;
    }

    resolveLogGroups() {
        const { cloudwatch } = this.config;

        if (Array.isArray(cloudwatch.logGroups) && cloudwatch.logGroups.length > 0) {
            return cloudwatch.logGroups.map(entry => {
                if (typeof entry === 'string') {
                    return entry;
                }
                return entry.name;
            }).filter(Boolean);
        }

        if (cloudwatch.logGroupName) {
            return [cloudwatch.logGroupName];
        }

        return [];
    }

    async init() {
        if (!this.authManager || !this.authManager.isAuthenticated()) {
            throw new Error('AwsAuthManager not authenticated');
        }

        await this.rebuildClient();
        await this.testCredentials();
        this.initialized = true;
    }

    async rebuildClient() {
        this.client = new CloudWatchLogsClient({
            region: this.config.aws.region,
            credentials: this.authManager.getCredentialProvider()
        });
    }

    ensureInitialized() {
        if (!this.initialized || !this.client) {
            throw new Error('CloudWatchClient not initialized');
        }
    }

    handleAuthError(error) {
        if (isTokenError(error)) {
            throw buildSsoExpiredError(this.config.aws.profile);
        }

        throw error;
    }

    async testCredentials() {
        const logGroupName = this.logGroups[0];
        if (!logGroupName) {
            throw new Error('No log groups configured');
        }

        try {
            const command = new FilterLogEventsCommand({
                logGroupName,
                limit: 1,
                startTime: Date.now() - 60000,
                endTime: Date.now()
            });

            await this.client.send(command);
            this.logger.info('✅ AWS SSO credentials working');

        } catch (error) {
            this.handleAuthError(error);
        }
    }

    applyPodKeywordsFilter(events) {
        if (!this.usesLegacyPodKeywords) {
            return events;
        }

        const keywords = this.config.cloudwatch.podKeywords;
        return events.filter(event => {
            const podName = event.logStreamName || '';
            const message = event.message || '';
            return keywords.some(keyword =>
                podName.toLowerCase().includes(keyword.toLowerCase()) ||
                message.toLowerCase().includes(keyword.toLowerCase())
            );
        });
    }

    async fetchLogsForLogGroup(logGroupName, startTime, endTime) {
        this.ensureInitialized();

        let events = [];
        let nextToken = null;
        let pageCount = 0;
        const maxPages = 10;

        do {
            try {
                const params = {
                    logGroupName,
                    startTime,
                    endTime,
                    limit: 10000
                };

                if (nextToken) {
                    params.nextToken = nextToken;
                }

                if (this.config.cloudwatch.filterPattern) {
                    params.filterPattern = this.config.cloudwatch.filterPattern;
                }

                const response = await this.client.send(new FilterLogEventsCommand(params));
                const pageEvents = (response.events || []).map(event => ({
                    ...event,
                    logGroupName
                }));

                events = events.concat(pageEvents);
                nextToken = response.nextToken;
                pageCount++;

                this.logger.debug(`[${logGroupName}] Pagina ${pageCount}: ${pageEvents.length} eventi`);

            } catch (error) {
                if (isTokenError(error)) {
                    throw buildSsoExpiredError(this.config.aws.profile);
                }

                this.logger.error(`Pagination error [${logGroupName}]:`, error.message);
                break;
            }
        } while (nextToken && pageCount < maxPages);

        return events;
    }

    async fetchLogsPaginated(startTime, endTime) {
        this.ensureInitialized();

        const maxResults = this.config.cloudwatch.maxResults || 100000;
        const countsByGroup = {};
        let allEvents = [];

        for (const logGroupName of this.logGroups) {
            const groupEvents = await this.fetchLogsForLogGroup(logGroupName, startTime, endTime);
            const filteredEvents = this.applyPodKeywordsFilter(groupEvents);
            countsByGroup[logGroupName] = filteredEvents.length;
            allEvents = allEvents.concat(filteredEvents);
        }

        this.logger.info('Events per log group', { countsByGroup, total: allEvents.length });

        allEvents.sort((a, b) => a.timestamp - b.timestamp);
        return allEvents.slice(0, maxResults);
    }
}

module.exports = CloudWatchClient;
