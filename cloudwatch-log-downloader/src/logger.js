const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class Logger {
    constructor(config) {
        const rawLevel = config.logging?.level || 'info';
        this.level = typeof rawLevel === 'string' ? rawLevel.toLowerCase() : 'info';
        this.enableConsole = config.logging.enableConsole !== false;
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    log(level, message, data = null) {
        if (this.logLevels[level] > this.logLevels[this.level]) {
            return;
        }

        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...(data && { data })
        };

        if (this.enableConsole) {
            console.log(JSON.stringify(logEntry));
        }
    }

    error(message, data) {
        this.log('error', message, data);
    }

    warn(message, data) {
        this.log('warn', message, data);
    }

    info(message, data) {
        this.log('info', message, data);
    }

    debug(message, data) {
        this.log('debug', message, data);
    }
}

module.exports = Logger;