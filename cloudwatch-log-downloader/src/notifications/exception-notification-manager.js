const crypto = require('crypto');
const path = require('path');

const { createExceptionMatcher } = require('../exception-pattern-matcher');
const { normalizeLogEvent } = require('../log-event-normalizer');
const { createChannels } = require('./channel-registry');
const NotificationStateStore = require('./notification-state-store');

const CONTEXT_BEFORE = 5;
const CONTEXT_AFTER = 5;
const CONTEXT_TIMEOUT_MS = 30000;
const RECENT_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

function stableHash(parts) {
    return crypto
        .createHash('sha256')
        .update(parts.map(part => String(part ?? '')).join('\u001F'))
        .digest('hex');
}

function eventIdentity(event) {
    return event.eventId || stableHash([
        event.timestamp,
        event.ingestionTime,
        event.logGroupName,
        event.logStreamName,
        event.body
    ]);
}

function compareEvents(left, right) {
    return (left.timestamp ?? 0) - (right.timestamp ?? 0)
        || (left.ingestionTime ?? 0) - (right.ingestionTime ?? 0)
        || String(left.eventId ?? '').localeCompare(String(right.eventId ?? ''));
}

function toContextEvent(event) {
    return {
        timestamp: event.timestamp,
        message: event.body
    };
}

class ExceptionNotificationManager {
    constructor(config, logger, options = {}) {
        this.project = config.project;
        this.environment = config.environment;
        this.monitorPatterns = config.monitorPatterns || [];
        this.isException = createExceptionMatcher(
            config.exceptionPatterns,
            config.excludeExceptionPatterns
        );
        this.logger = logger;
        this.channels = options.channels ?? createChannels(
            config.channels,
            logger,
            options.channelOptions
        );
        const statePath = path.join(
            path.resolve(config.logDirectory),
            `.${config.filePrefix}-notification-state.json`
        );
        this.stateStore = options.stateStore
            ?? new NotificationStateStore(statePath, logger, options.stateOptions);
        this.now = options.now ?? Date.now;
        this.setTimer = options.setTimeout ?? setTimeout;
        this.clearTimer = options.clearTimeout ?? clearTimeout;
        this.buffers = new Map();
        this.pending = new Set();
        this.digestGroups = new Map();
        this.deliveries = new Set();
        this.recentEvents = new Map();
        this.accepting = true;
    }

    async init() {
        await this.stateStore.init();
    }

    shouldInclude(body) {
        return this.monitorPatterns.length === 0
            || this.monitorPatterns.some(pattern => body.includes(pattern));
    }

    streamKey(event) {
        return `${event.logGroupName}\u001F${event.logStreamName}`;
    }

    notificationId(event) {
        return stableHash([
            this.project,
            event.logGroupName,
            eventIdentity(event)
        ]);
    }

    channelNotificationKey(event, channelId) {
        return stableHash([
            this.project,
            event.logGroupName,
            eventIdentity(event),
            channelId
        ]);
    }

    digestGroupKey(channelId, exceptionFileName) {
        return stableHash([
            this.project,
            channelId,
            exceptionFileName
        ]);
    }

    digestNotificationId(channelId, exceptionFileName, keys) {
        return stableHash([
            this.project,
            channelId,
            exceptionFileName,
            ...keys
        ]);
    }

    recentEventKey(event) {
        return stableHash([
            event.logGroupName,
            event.logStreamName,
            eventIdentity(event)
        ]);
    }

    isDuplicateEvent(event) {
        const cutoff = this.now() - RECENT_EVENT_RETENTION_MS;
        for (const [key, seenAt] of this.recentEvents) {
            if (seenAt < cutoff) {
                this.recentEvents.delete(key);
            }
        }

        const key = this.recentEventKey(event);
        if (this.recentEvents.has(key)) {
            return true;
        }
        this.recentEvents.set(key, this.now());
        return false;
    }

    ingest(events, writeSummary = {}) {
        if (!this.accepting || this.channels.length === 0 || !Array.isArray(events)) {
            return;
        }

        const normalizedEvents = events
            .map(normalizeLogEvent)
            .sort(compareEvents);

        for (const event of normalizedEvents) {
            if (this.isDuplicateEvent(event)) {
                continue;
            }
            if (!this.shouldInclude(event.body)) {
                continue;
            }

            const streamKey = this.streamKey(event);
            const contextEvent = toContextEvent(event);

            for (const pending of [...this.pending]) {
                if (pending.streamKey !== streamKey || pending.finalized) {
                    continue;
                }
                pending.after.push(contextEvent);
                if (pending.after.length >= CONTEXT_AFTER) {
                    this.finalizePending(pending, false);
                }
            }

            const buffer = this.buffers.get(streamKey) || [];
            if (this.isException(event.body)) {
                this.handleExceptionEvent(event, streamKey, buffer, writeSummary);
            }

            buffer.push(contextEvent);
            if (buffer.length > CONTEXT_BEFORE) {
                buffer.splice(0, buffer.length - CONTEXT_BEFORE);
            }
            this.buffers.set(streamKey, buffer);
        }
    }

    handleExceptionEvent(event, streamKey, buffer, writeSummary = {}) {
        const singleTargets = [];
        for (const channel of this.channels) {
            const grouping = channel.grouping || { mode: 'single' };
            if (
                grouping.mode === 'exception-file'
                && writeSummary?.exceptionFileName
            ) {
                this.addToDigestGroup(event, channel, writeSummary.exceptionFileName);
                continue;
            }

            const key = this.channelNotificationKey(event, channel.id);
            if (this.stateStore.reserve(key)) {
                singleTargets.push({ channel, key });
            }
        }

        if (singleTargets.length > 0) {
            this.openPending(event, streamKey, buffer, singleTargets);
        }
    }

    addToDigestGroup(event, channel, exceptionFileName) {
        const key = this.channelNotificationKey(event, channel.id);
        if (!this.stateStore.reserve(key)) {
            return;
        }

        const groupKey = this.digestGroupKey(channel.id, exceptionFileName);
        let group = this.digestGroups.get(groupKey);
        if (!group) {
            group = {
                channel,
                exceptionFileName,
                entries: [],
                timer: null,
                finalized: false
            };
            const flushDelaySeconds = channel.grouping?.flushDelaySeconds ?? 70;
            group.timer = this.setTimer(
                () => this.flushDigestGroup(group),
                flushDelaySeconds * 1000
            );
            this.digestGroups.set(groupKey, group);
        }

        group.entries.push({ event, key });
    }

    openPending(event, streamKey, buffer, targets) {
        if (targets.length === 0) {
            return;
        }

        const pending = {
            streamKey,
            event,
            before: [...buffer],
            after: [],
            targets,
            finalized: false,
            timer: null
        };
        pending.timer = this.setTimer(
            () => this.finalizePending(pending, true),
            CONTEXT_TIMEOUT_MS
        );
        this.pending.add(pending);
    }

    buildDigestNotification(group) {
        const keys = group.entries.map(entry => entry.key).sort();

        return {
            type: 'exception-file-digest',
            notificationId: this.digestNotificationId(
                group.channel.id,
                group.exceptionFileName,
                keys
            ),
            project: this.project,
            environment: this.environment,
            detectedAt: new Date(this.now()).toISOString(),
            exceptionFileName: group.exceptionFileName,
            exceptionCount: group.entries.length
        };
    }

    async flushDigestGroup(group) {
        if (group.finalized) {
            return;
        }
        group.finalized = true;
        this.digestGroups.delete(this.digestGroupKey(
            group.channel.id,
            group.exceptionFileName
        ));
        if (group.timer) {
            this.clearTimer(group.timer);
        }

        const notification = this.buildDigestNotification(group);
        await this.trackDelivery(this.deliverDigest(group, notification));
    }

    async deliverDigest(group, notification) {
        let status = 'failed';
        try {
            const result = await group.channel.send(notification);
            status = result?.status === 'sent' ? 'sent' : 'failed';
        } catch (error) {
            this.logger.error(
                `[${this.project}] Errore inatteso nel channel ${group.channel.id}`,
                { message: error.message }
            );
        }

        await Promise.all(group.entries.map(async entry => {
            try {
                await this.stateStore.complete(entry.key, status);
            } catch (error) {
                this.logger.error(
                    `[${this.project}] Impossibile persistere lo stato della notifica`,
                    { channelId: group.channel.id, message: error.message }
                );
            }
        }));
    }

    buildNotification(pending, timedOut) {
        return {
            notificationId: this.notificationId(pending.event),
            project: this.project,
            environment: this.environment,
            detectedAt: new Date(this.now()).toISOString(),
            exception: {
                eventId: pending.event.eventId,
                timestamp: new Date(pending.event.timestamp).toISOString(),
                logGroupName: pending.event.logGroupName,
                logStreamName: pending.event.logStreamName,
                message: pending.event.body
            },
            context: {
                before: pending.before,
                after: pending.after.slice(0, CONTEXT_AFTER),
                timedOut
            }
        };
    }

    async finalizePending(pending, timedOut) {
        if (pending.finalized) {
            return;
        }
        pending.finalized = true;
        this.pending.delete(pending);
        if (pending.timer) {
            this.clearTimer(pending.timer);
        }

        const notification = this.buildNotification(pending, timedOut);
        const deliveries = pending.targets.map(target =>
            this.trackDelivery(this.deliver(target, notification))
        );
        await Promise.all(deliveries);
    }

    trackDelivery(promise) {
        this.deliveries.add(promise);
        promise.finally(() => {
            this.deliveries.delete(promise);
        });
        return promise;
    }

    async deliver(target, notification) {
        let status = 'failed';
        try {
            const result = await target.channel.send(notification);
            status = result?.status === 'sent' ? 'sent' : 'failed';
        } catch (error) {
            this.logger.error(
                `[${this.project}] Errore inatteso nel channel ${target.channel.id}`,
                { message: error.message }
            );
        }

        try {
            await this.stateStore.complete(target.key, status);
        } catch (error) {
            this.logger.error(
                `[${this.project}] Impossibile persistere lo stato della notifica`,
                { channelId: target.channel.id, message: error.message }
            );
        }
    }

    async waitForIdle() {
        while (this.deliveries.size > 0) {
            await Promise.allSettled([...this.deliveries]);
        }
    }

    async close(options = {}) {
        this.accepting = false;
        const pending = [...this.pending];
        for (const item of pending) {
            this.finalizePending(item, false);
        }
        for (const group of [...this.digestGroups.values()]) {
            this.flushDigestGroup(group);
        }

        const timeoutMs = options.timeoutMs ?? 15000;
        let timeout;
        await Promise.race([
            this.waitForIdle(),
            new Promise(resolve => {
                timeout = this.setTimer(resolve, timeoutMs);
            })
        ]);
        if (timeout) {
            this.clearTimer(timeout);
        }
        await this.stateStore.flush();
    }
}

module.exports = ExceptionNotificationManager;
module.exports.stableHash = stableHash;
module.exports.eventIdentity = eventIdentity;
module.exports.compareEvents = compareEvents;
module.exports.toContextEvent = toContextEvent;
