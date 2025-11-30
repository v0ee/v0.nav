const { normalizeUuid } = require('../utils/uuid');

class TpaModule {
    constructor(bot, accessControl, logger) {
        this.bot = bot;
        this.accessControl = accessControl;
        this.logger = logger;
        this.setupListeners();
    }

    setupListeners() {
        this.bot.on('message', (jsonMsg) => {
            const plainText = jsonMsg.toString();
            const match = plainText.match(/^(\w+) wants to teleport to you\./);
            if (match) {
                const username = match[1];
                this.handleRequest(username);
            }
        });
    }

    handleRequest(username) {
        const uuid = this.resolveUuid(username);
        if (!uuid) {
            this.logger?.logTpa({ username, uuid: null, action: 'deny', reason: 'unknown-uuid' });
            this.bot.chat(`/tpn ${username}`);
            return;
        }

        const trusted = this.accessControl.isTrusted({ uuid, username });
        this.accessControl.recordSeen({ uuid, username });
        if (trusted) {
            this.logger?.logTpa({ username, uuid, action: 'accept' });
            this.bot.chat(`/tpy ${username}`);
        } else {
            this.logger?.logTpa({ username, uuid, action: 'deny', reason: 'not-whitelisted' });
            this.bot.chat(`/tpn ${username}`);
        }
    }

    resolveUuid(username) {
        const player = this.bot.players[username];
        if (player && player.uuid) {
            return normalizeUuid(player.uuid);
        }
        return null;
    }
}

module.exports = TpaModule;
