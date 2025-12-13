const fs = require('fs');
const path = require('path');

function timestamp() {
    return new Date().toISOString();
}

class SessionLogger {
    constructor({ directory, instanceId, instanceName }) {
        this.directory = directory || path.join(process.cwd(), 'logs');
        this.instanceId = instanceId || 'default';
        this.instanceName = instanceName || 'main';
        fs.mkdirSync(this.directory, { recursive: true });
        this.filePath = path.join(this.directory, this.buildFilename());
        this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
        this.log('system', 'session.start', { instanceId: this.instanceId, instanceName: this.instanceName });
    }

    buildFilename() {
        const stamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .replace('Z', '');
        const prefix = this.instanceId !== 'default' ? `${this.instanceId.slice(0, 12)}_` : '';
        return `session-${prefix}${stamp}.log`;
    }

    log(category, message, data = {}) {
        if (!this.stream) return;
        const entry = {
            ts: timestamp(),
            category,
            message,
            instanceId: this.instanceId,
            data
        };
        this.stream.write(JSON.stringify(entry) + '\n');
    }

    logError(context, error, additionalData = {}) {
        if (!this.stream) return;
        const entry = {
            ts: timestamp(),
            category: 'error',
            message: context,
            instanceId: this.instanceId,
            data: {
                ...additionalData,
                errorMessage: error?.message || String(error),
                errorName: error?.name || 'Error',
                errorStack: error?.stack || null,
                errorCode: error?.code || null
            }
        };
        this.stream.write(JSON.stringify(entry) + '\n');
    }


    logWarning(context, details = {}) {
        this.log('warning', context, details);
    }


    logDebug(context, details = {}) {
        this.log('debug', context, details);
    }

    logCommand(payload) {
        this.log('command', 'execute', payload);
    }

    logTpa(payload) {
        this.log('tpa', 'request', payload);
    }

    logPlayerRange(payload) {
        this.log('player-range', 'update', payload);
    }

    close(reason = 'shutdown') {
        this.log('system', 'session.end', { reason });
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
    }
}

module.exports = {
    SessionLogger
};
