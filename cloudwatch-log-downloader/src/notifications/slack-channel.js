const https = require('https');

const MAX_SLACK_TEXT_LENGTH = 3900;
const RETRY_DELAYS_MS = [1000, 5000];

class SlackMessageTooLongError extends Error {
    constructor() {
        super('Intestazione ed eccezione superano il limite Slack');
        this.name = 'SlackMessageTooLongError';
    }
}

function sanitizeSlackText(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/\r?\n/g, ' ↵ ')
        .replace(/`{3,}/g, "'''")
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatUtcTime(timestamp) {
    return new Date(timestamp).toISOString().slice(11, 19);
}

function formatEventLine(event, isException = false) {
    const marker = isException ? '[ECCEZIONE] ' : '';
    return `${formatUtcTime(event.timestamp)} ${marker}${sanitizeSlackText(event.message)}`;
}

function buildSlackText(notification, before, after, includeOmittedCount = true) {
    const exception = notification.exception;
    const lines = [
        `Progetto: ${sanitizeSlackText(notification.project)}`,
        `Ambiente: ${sanitizeSlackText(notification.environment)}`,
        `Timestamp: ${sanitizeSlackText(exception.timestamp)}`,
        `Log group: ${sanitizeSlackText(exception.logGroupName)}`,
        `Log stream: ${sanitizeSlackText(exception.logStreamName)}`,
        '',
        ...before.map(event => formatEventLine(event)),
        formatEventLine({
            timestamp: exception.timestamp,
            message: exception.message
        }, true),
        ...after.map(event => formatEventLine(event))
    ];

    const totalContext = notification.context.before.length
        + notification.context.after.length;
    const omitted = totalContext - before.length - after.length;
    if (includeOmittedCount && omitted > 0) {
        lines.push(`Righe di contesto omesse: ${omitted}`);
    }
    return lines.join('\n');
}

function formatSlackMessage(notification) {
    const before = [...(notification.context.before || [])];
    const after = [...(notification.context.after || [])];
    const minimalText = buildSlackText(notification, [], [], false);
    if (minimalText.length > MAX_SLACK_TEXT_LENGTH) {
        throw new SlackMessageTooLongError();
    }

    let removeBeforeNext = true;
    let text = buildSlackText(notification, before, after, false);
    while (text.length > MAX_SLACK_TEXT_LENGTH && (before.length || after.length)) {
        const beforeDistance = before.length;
        const afterDistance = after.length;

        if (
            before.length > 0
            && (
                after.length === 0
                || beforeDistance > afterDistance
                || (beforeDistance === afterDistance && removeBeforeNext)
            )
        ) {
            before.shift();
            removeBeforeNext = false;
        } else {
            after.pop();
            removeBeforeNext = true;
        }
        text = buildSlackText(notification, before, after, false);
    }

    const textWithOmittedCount = buildSlackText(notification, before, after);
    if (textWithOmittedCount.length <= MAX_SLACK_TEXT_LENGTH) {
        return textWithOmittedCount;
    }
    return text;
}

function postJson(url, payload, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const request = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, response => {
            const chunks = [];
            response.on('data', chunk => {
                if (chunks.reduce((sum, item) => sum + item.length, 0) < 8192) {
                    chunks.push(chunk);
                }
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode,
                    headers: response.headers,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            const error = new Error('timeout');
            error.code = 'ETIMEDOUT';
            request.destroy(error);
        });
        request.on('error', reject);
        request.end(body);
    });
}

function isRetryableResponse(response) {
    return response.statusCode === 429 || response.statusCode >= 500;
}

function retryDelay(response, attemptIndex) {
    if (response?.statusCode === 429) {
        const retryAfterSeconds = Number.parseInt(response.headers?.['retry-after'], 10);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
            return retryAfterSeconds * 1000;
        }
    }
    return RETRY_DELAYS_MS[attemptIndex]
        ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

class SlackChannel {
    constructor(config, logger, options = {}) {
        this.id = config.id;
        this.logger = logger;
        this.webhookUrl = options.webhookUrl ?? process.env[config.webhookUrlEnv];
        this.request = options.request ?? postJson;
        this.sleep = options.sleep ?? (milliseconds =>
            new Promise(resolve => setTimeout(resolve, milliseconds))
        );
    }

    async send(notification) {
        let text;
        try {
            text = formatSlackMessage(notification);
        } catch (error) {
            if (error instanceof SlackMessageTooLongError) {
                this.logger.error(
                    `[${notification.project}] Eccezione troppo lunga per il channel ${this.id}: invio non eseguito`
                );
                return { status: 'failed', attempts: 0 };
            }
            throw error;
        }

        const payload = {
            text,
            mrkdwn: false,
            unfurl_links: false,
            unfurl_media: false
        };

        for (let attempt = 1; attempt <= 3; attempt++) {
            let response;
            try {
                response = await this.request(this.webhookUrl, payload, {
                    timeoutMs: 10000
                });
                if (response.statusCode === 200 && response.body.trim() === 'ok') {
                    this.logger.info(
                        `[${notification.project}] Notifica inviata al channel ${this.id}`
                    );
                    return { status: 'sent', attempts: attempt };
                }
                if (!isRetryableResponse(response)) {
                    this.logger.error(
                        `[${notification.project}] Notifica rifiutata dal channel ${this.id}`,
                        { attempt, statusCode: response.statusCode }
                    );
                    return { status: 'failed', attempts: attempt };
                }
            } catch (error) {
                response = null;
                if (attempt === 3) {
                    this.logger.error(
                        `[${notification.project}] Notifica abbandonata per il channel ${this.id} dopo 3 tentativi`,
                        { category: error.code || 'network' }
                    );
                    return { status: 'failed', attempts: attempt };
                }
            }

            if (attempt === 3) {
                this.logger.error(
                    `[${notification.project}] Notifica abbandonata per il channel ${this.id} dopo 3 tentativi`,
                    { statusCode: response?.statusCode }
                );
                return { status: 'failed', attempts: attempt };
            }

            this.logger.warn(
                `[${notification.project}] Tentativo ${attempt}/3 fallito per il channel ${this.id}`,
                { statusCode: response?.statusCode }
            );
            await this.sleep(retryDelay(response, attempt - 1));
        }

        return { status: 'failed', attempts: 3 };
    }
}

module.exports = {
    SlackChannel,
    formatSlackMessage,
    sanitizeSlackText,
    formatUtcTime,
    formatEventLine,
    postJson,
    MAX_SLACK_TEXT_LENGTH,
    SlackMessageTooLongError
};
