function normalizeLogEvent(event = {}) {
    const logGroupName = event.logGroupName || 'unknown';
    const logStreamName = event.logStreamName || 'unknown';
    let body = event.message || '';
    let containerName = null;

    try {
        const logObject = JSON.parse(event.message);
        if (typeof logObject.log === 'string') {
            body = logObject.log.trim();
        }
        containerName = logObject.kubernetes?.container_name || null;
    } catch (error) {
        // Payload non JSON: usa il messaggio originale.
    }

    return {
        eventId: event.eventId,
        timestamp: event.timestamp,
        ingestionTime: event.ingestionTime,
        logGroupName,
        logStreamName,
        containerName,
        body
    };
}

function formatNormalizedLogLine(event) {
    const timestamp = new Date(event.timestamp).toISOString();
    const sourceParts = [`[logGroup=${event.logGroupName}]`];

    if (event.containerName) {
        sourceParts.push(`[container=${event.containerName}]`);
    }

    return `[${timestamp}] ${sourceParts.join(' ')} ${event.body}`;
}

module.exports = {
    normalizeLogEvent,
    formatNormalizedLogLine
};
