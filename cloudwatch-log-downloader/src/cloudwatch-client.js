const {
    CloudWatchLogsClient,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    FilterLogEventsCommand
} = require('@aws-sdk/client-cloudwatch-logs');
const { buildSsoExpiredError, isTokenError } = require('./aws-auth-manager');

class CloudWatchClient {
    constructor(config, logger, authManager) {
        this.config = config;
        this.logger = logger;
        this.authManager = authManager;
        this.logGroupEntries = this.resolveLogGroupEntries();
        this.logGroups = this.resolveCompleteLogGroups();
        this.usesLegacyPodKeywords = this.logGroups.length === 1
            && !!this.config.cloudwatch.logGroupName
            && !this.config.cloudwatch.logGroups?.length
            && Array.isArray(this.config.cloudwatch.podKeywords)
            && this.config.cloudwatch.podKeywords.length > 0;
        this.client = null;
        this.initialized = false;
        this.refreshInProgress = false;
        this.prefixDiscoveryState = new Map();
    }

    normalizeLogGroupEntry(entry) {
        if (typeof entry === 'string' && entry.trim()) {
            return { type: 'complete', name: entry.trim() };
        }

        if (entry?.type === 'complete' && typeof entry.name === 'string') {
            const name = entry.name.trim();
            return name ? { type: 'complete', name } : null;
        }

        if (entry?.type === 'prefix' && typeof entry.prefix === 'string') {
            const prefix = entry.prefix.trim();
            return prefix ? { type: 'prefix', prefix } : null;
        }

        if (entry?.complete && typeof entry.complete === 'string') {
            const name = entry.complete.trim();
            return name ? { type: 'complete', name } : null;
        }

        if (entry?.prefix && typeof entry.prefix === 'string') {
            const prefix = entry.prefix.trim();
            return prefix ? { type: 'prefix', prefix } : null;
        }

        return null;
    }

    resolveLogGroupEntries() {
        const { cloudwatch } = this.config;

        if (Array.isArray(cloudwatch.logGroups) && cloudwatch.logGroups.length > 0) {
            return cloudwatch.logGroups
                .map(entry => this.normalizeLogGroupEntry(entry))
                .filter(Boolean);
        }

        if (cloudwatch.logGroupName) {
            return [{ type: 'complete', name: cloudwatch.logGroupName }];
        }

        return [];
    }

    resolveCompleteLogGroups() {
        return this.logGroupEntries
            .filter(entry => entry.type === 'complete')
            .map(entry => entry.name);
    }

    async init(options = {}) {
        if (!this.authManager || !this.authManager.isAuthenticated()) {
            throw new Error('AwsAuthManager not authenticated');
        }

        await this.rebuildClient();
        await this.resolveConfiguredLogGroups({
            now: options.now,
            failIfEmpty: true
        });

        if (!options.skipCredentialTest) {
            await this.testCredentials();
        }

        this.initialized = true;
    }

    async rebuildClient() {
        this.client = new CloudWatchLogsClient({
            region: this.config.aws.region,
            credentials: this.authManager.getCredentialProvider()
        });
    }

    addUniqueLogGroup(target, seen, logGroupName) {
        if (!logGroupName || seen.has(logGroupName)) {
            return;
        }

        seen.add(logGroupName);
        target.push(logGroupName);
    }

    getDiscoveryWindowStart(now = Date.now()) {
        const activeWindowHours = this.config.cloudwatch.logGroupDiscovery
            ?.activeWindowHours ?? 4;
        return now - (activeWindowHours * 60 * 60 * 1000);
    }

    getEventualConsistencyGraceStart(now = Date.now()) {
        const graceMinutes = this.config.cloudwatch.logGroupDiscovery
            ?.eventualConsistencyGraceMinutes ?? 90;
        if (graceMinutes <= 0) {
            return null;
        }
        return now - (graceMinutes * 60 * 1000);
    }

    isWithinWindow(timestamp, windowStart) {
        return Number.isFinite(Number(timestamp)) && Number(timestamp) >= windowStart;
    }

    getPrefixDiscoveryState(prefix) {
        if (!this.prefixDiscoveryState.has(prefix)) {
            this.prefixDiscoveryState.set(prefix, {
                knownNames: new Set(),
                firstSeenAtByName: new Map(),
                newNameGraceNames: new Set(),
                missingCountsByName: new Map(),
                initialCount: null
            });
        }

        return this.prefixDiscoveryState.get(prefix);
    }

    updatePrefixDiscoveryState(prefix, logGroupNames, options = {}) {
        const now = options.now ?? Date.now();
        const state = this.getPrefixDiscoveryState(prefix);
        const currentNames = new Set(logGroupNames);
        const newNames = [];
        const removedNames = [];

        if (state.initialCount === null) {
            state.initialCount = logGroupNames.length;
            for (const logGroupName of logGroupNames) {
                state.knownNames.add(logGroupName);
                state.firstSeenAtByName.set(logGroupName, now);
                state.missingCountsByName.set(logGroupName, 0);
            }
            return { state, newNames, removedNames };
        }

        for (const logGroupName of logGroupNames) {
            if (!state.knownNames.has(logGroupName)) {
                newNames.push(logGroupName);
                state.knownNames.add(logGroupName);
                state.firstSeenAtByName.set(logGroupName, now);
                state.newNameGraceNames.add(logGroupName);
            }
            state.missingCountsByName.set(logGroupName, 0);
        }

        for (const knownName of [...state.knownNames]) {
            if (currentNames.has(knownName)) {
                continue;
            }

            const missingCount = (state.missingCountsByName.get(knownName) || 0) + 1;
            if (missingCount >= 2) {
                removedNames.push(knownName);
                state.knownNames.delete(knownName);
                state.firstSeenAtByName.delete(knownName);
                state.newNameGraceNames.delete(knownName);
                state.missingCountsByName.delete(knownName);
            } else {
                state.missingCountsByName.set(knownName, missingCount);
            }
        }

        return { state, newNames, removedNames };
    }

    async getLatestLogStream(logGroupName) {
        try {
            const response = await this.client.send(
                new DescribeLogStreamsCommand({
                    logGroupName,
                    orderBy: 'LastEventTime',
                    descending: true,
                    limit: 1
                })
            );
            return (response.logStreams || [])[0] || null;
        } catch (error) {
            this.handleAuthError(error);
        }
    }

    classifyDiscoveredLogGroup(logGroup, latestStream, state, options = {}) {
        const now = options.now ?? Date.now();
        const windowStart = this.getDiscoveryWindowStart(now);
        const graceStart = this.getEventualConsistencyGraceStart(now);
        const logGroupName = logGroup.logGroupName;
        const firstSeenAt = state.firstSeenAtByName.get(logGroupName);

        if (this.isWithinWindow(latestStream?.lastEventTimestamp, windowStart)) {
            return 'recent-activity';
        }

        if (this.isWithinWindow(latestStream?.lastIngestionTime, windowStart)) {
            return 'recent-ingestion';
        }

        if (graceStart !== null && this.isWithinWindow(logGroup.creationTime, graceStart)) {
            return 'creation-grace';
        }

        if (
            graceStart !== null
            && state.newNameGraceNames.has(logGroupName)
            && this.isWithinWindow(firstSeenAt, graceStart)
        ) {
            return 'new-name-grace';
        }

        if (
            state.newNameGraceNames.has(logGroupName)
            && (graceStart === null || !this.isWithinWindow(firstSeenAt, graceStart))
        ) {
            state.newNameGraceNames.delete(logGroupName);
        }

        return null;
    }

    async discoverLogGroupsByPrefix(prefix, options = {}) {
        const discovered = [];
        let ignoredCount = 0;
        let nextToken = null;
        const discoveredByReason = {
            recentActivity: 0,
            recentIngestion: 0,
            creationGrace: 0,
            newNameGrace: 0
        };
        const candidateGroups = [];

        do {
            try {
                const params = { logGroupNamePrefix: prefix };
                if (nextToken) {
                    params.nextToken = nextToken;
                }

                const response = await this.client.send(
                    new DescribeLogGroupsCommand(params)
                );
                candidateGroups.push(...(response.logGroups || [])
                    .filter(group => group?.logGroupName));
                nextToken = response.nextToken;
            } catch (error) {
                this.handleAuthError(error);
            }
        } while (nextToken);

        const { state, newNames, removedNames } = this.updatePrefixDiscoveryState(
            prefix,
            candidateGroups.map(group => group.logGroupName),
            options
        );

        for (const logGroup of candidateGroups) {
            const latestStream = await this.getLatestLogStream(logGroup.logGroupName);
            const reason = this.classifyDiscoveredLogGroup(
                logGroup,
                latestStream,
                state,
                options
            );

            if (reason) {
                discovered.push(logGroup.logGroupName);
                if (reason === 'recent-activity') {
                    discoveredByReason.recentActivity++;
                } else if (reason === 'recent-ingestion') {
                    discoveredByReason.recentIngestion++;
                } else if (reason === 'creation-grace') {
                    discoveredByReason.creationGrace++;
                } else if (reason === 'new-name-grace') {
                    discoveredByReason.newNameGrace++;
                }
            } else {
                ignoredCount++;
            }
        }

        discovered.sort();

        if (discovered.length === 0) {
            this.logger.warn('Nessun log group trovato per il prefix CloudWatch', {
                prefix,
                ignoredCount,
                initialCount: state.initialCount,
                currentCount: candidateGroups.length,
                newCount: newNames.length,
                removedCount: removedNames.length
            });
        } else {
            this.logger.info('Log group CloudWatch risolti da prefix', {
                prefix,
                count: discovered.length,
                ignoredCount,
                initialCount: state.initialCount,
                currentCount: candidateGroups.length,
                newCount: newNames.length,
                removedCount: removedNames.length,
                includedByRecentActivity: discoveredByReason.recentActivity,
                includedByRecentIngestion: discoveredByReason.recentIngestion,
                includedByCreationGrace: discoveredByReason.creationGrace,
                includedByNewNameGrace: discoveredByReason.newNameGrace
            });
        }

        return discovered;
    }

    async resolveConfiguredLogGroups(options = {}) {
        const resolved = [];
        const seen = new Set();

        for (const entry of this.logGroupEntries) {
            if (entry.type === 'complete') {
                this.addUniqueLogGroup(resolved, seen, entry.name);
                continue;
            }

            if (entry.type === 'prefix') {
                const discovered = await this.discoverLogGroupsByPrefix(
                    entry.prefix,
                    options
                );
                for (const logGroupName of discovered) {
                    this.addUniqueLogGroup(resolved, seen, logGroupName);
                }
            }
        }

        if (resolved.length === 0) {
            if (options.failIfEmpty === false) {
                this.logger.warn('Nessun log group CloudWatch attivo dopo la discovery');
            } else {
                throw new Error('Nessun log group CloudWatch risolto dalla configurazione');
            }
        }

        this.logGroups = resolved;
        return resolved;
    }

    hasPrefixLogGroups() {
        return this.logGroupEntries.some(entry => entry.type === 'prefix');
    }

    async refreshConfiguredLogGroups(options = {}) {
        if (!this.hasPrefixLogGroups()) {
            return [...this.logGroups];
        }

        if (this.refreshInProgress) {
            this.logger.warn('Discovery prefix CloudWatch gia in corso');
            return [...this.logGroups];
        }

        this.refreshInProgress = true;
        try {
            const previousCount = this.logGroups.length;
            const resolved = await this.resolveConfiguredLogGroups({
                now: options.now,
                failIfEmpty: false
            });
            this.logger.info('Discovery prefix CloudWatch aggiornata', {
                previousCount,
                currentCount: resolved.length
            });
            return resolved;
        } finally {
            this.refreshInProgress = false;
        }
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
