const fs = require('fs');
const path = require('path');

function timestamp() {
    return new Date().toISOString();
}

class SessionLogger {
    constructor({ directory }) {
        this.directory = directory || path.join(process.cwd(), 'logs');
        fs.mkdirSync(this.directory, { recursive: true });
        this.filePath = path.join(this.directory, this.buildFilename());
        this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
        this.log('system', 'session.start');
    }

    buildFilename() {
        const stamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .replace('Z', '');
        return `session-${stamp}.log`;
    }

    log(category, message, data = {}) {
        if (!this.stream) return;
        const entry = {
            ts: timestamp(),
            category,
            message,
            data
        };
        this.stream.write(JSON.stringify(entry) + '\n');
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
