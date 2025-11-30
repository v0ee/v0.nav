const fs = require('fs');
const { normalizeUuid } = require('../utils/uuid');

class Commander {
    constructor(bot, elytraFly, accessControl, waypointsFile, options = {}) {
        this.bot = bot;
        this.elytraFly = elytraFly;
        this.accessControl = accessControl;
        this.waypointsFile = waypointsFile;
        this.waypoints = {};
        this.commandRouter = options.commandRouter;
        this.forwardSystemLog = options.forwardSystemLog;
        this.logger = options.logger;
        this.themeManager = options.themeManager;

        if (!this.commandRouter || !this.accessControl) {
            throw new Error('Commander requires command router and access control instances');
        }

        this.loadWaypoints();
        this.setupListeners();
    }

    loadWaypoints() {
        try {
            if (fs.existsSync(this.waypointsFile)) {
                this.waypoints = JSON.parse(fs.readFileSync(this.waypointsFile, 'utf8'));
            }
        } catch (err) {
            console.error('[Commander] Error loading waypoints:', err);
        }
    }

    saveWaypoints() {
        try {
            fs.writeFileSync(this.waypointsFile, JSON.stringify(this.waypoints, null, 4));
        } catch (err) {
            console.error('[Commander] Error saving waypoints:', err);
        }
    }

    setupListeners() {
        this.bot.on('whisper', (username, message) => {
            if (username === this.bot.username) return;
            Promise.resolve(this.handleCommand(username, message)).catch(err => {
                const errorMessage = err?.message || 'Unknown error';
                console.error(`[Commander] Error executing command "${message}" from ${username}:`, err);
                if (this.forwardSystemLog) {
                    this.forwardSystemLog(`[Commander] ${errorMessage}`, 'red');
                }
                this.respond(username, `Error: ${errorMessage}`);
            });
        });
    }

    async handleCommand(username, message) {
        const uuid = this.resolveUuid(username);
        if (uuid) {
            this.accessControl.recordSeen({ uuid, username });
        }
        if (!this.accessControl.isAdmin({ uuid, username })) {
            this.logger?.log('security', 'command.denied', { username, uuid, reason: 'not-admin' });
            this.respond(username, 'You do not have permission to run commands.');
            return;
        }

        const trimmed = (message || '').trim();
        if (!trimmed) return;
        const parts = trimmed.split(/\s+/);
        if (!parts.length) return;
        let raw = parts.shift();
        if (!raw) return;
        const prefix = this.commandRouter.prefix || '';
        if (prefix && raw.startsWith(prefix)) {
            raw = raw.slice(prefix.length);
        }
        const name = raw.toLowerCase();
        if (!name) return;
        const context = this.buildCommandContext(username, uuid);
        const result = await this.commandRouter.executeCommand(name, parts, context);
        if (!result.ok && result.error) {
            const errMessage = result.error instanceof Error ? result.error.message : result.error;
            if (errMessage) {
                this.respond(username, `Error: ${errMessage}`);
            }
        }
    }

    buildCommandContext(username, uuid) {
        return {
            respond: (msg, color) => this.respond(username, msg, color),
            getBot: () => this.bot,
            getElytraFly: () => this.elytraFly,
            getCommander: () => this,
            accessControl: this.accessControl,
            logger: this.logger,
            themeManager: this.themeManager,
            initiator: {
                type: 'whisper',
                username,
                uuid
            }
        };
    }

    respond(username, message) {
        this.bot.chat(`/w ${username} ${message}`);
    }

    resolveUuid(username) {
        const player = this.bot.players[username];
        if (player && player.uuid) {
            return normalizeUuid(player.uuid);
        }
        return null;
    }
}

module.exports = Commander;
