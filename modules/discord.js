const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const fs = require('fs');
const { parseChatSegments } = require('../lib/chatParser');
const { getOnlinePlayers, computeEta } = require('../lib/statusPanel');

const INPUT_BUTTON_ID = 'flightbot.input';
const INPUT_MODAL_ID = 'flightbot.input.modal';
const INPUT_FIELD_ID = 'flightbot.input.field';
const CHAT_HISTORY_LIMIT = 12;
const DISCORD_UPDATE_MIN_INTERVAL = 1000;

class DiscordModule {
    constructor(bot, elytraFly, commander, configPath, options = {}) {
        this.bot = bot;
        this.elytraFly = elytraFly;
        this.commander = commander;
        this.configPath = configPath;
        this.destroyed = false;
        this.lastPos = null;
        this.lastTime = null;
        this.currentBps = 0;
        this.arrivedFlag = false;
        this.arrivedWaypointName = null;
        this.commandRouter = options.commandRouter;
        this.forwardSystemLog = options.forwardSystemLog;
        this.accessControl = options.accessControl;
        this.logger = options.logger;
        this.themeManager = options.themeManager;
        this.logChatMessage = options.logChatMessage;
        this.chatLog = [];
        this.connectedAt = null;
        this.handleBotChat = this.handleBotChat.bind(this);
        this.handleBotSpawn = this.handleBotSpawn.bind(this);
        this.handleBotEnd = this.handleBotEnd.bind(this);
        this.handleThemeChange = this.handleThemeChange.bind(this);
        this.updateTimer = null;
        this.getConfigFn = options.getConfig;
        this.saveConfigFn = options.saveConfig;

        if (!this.commandRouter) {
            throw new Error('Discord module requires a command router instance');
        }

        this.config = this.loadInitialConfig();

        if (this.bot) {
            this.bot.on('message', this.handleBotChat);
            this.bot.on('spawn', this.handleBotSpawn);
            this.bot.on('end', this.handleBotEnd);
        }

        if (this.themeManager && typeof this.themeManager.on === 'function') {
            this.themeManager.on('change', this.handleThemeChange);
        }

        if (!this.config.discord || !this.config.discord.token || !this.config.discord.channelId) {
            console.log('[Discord] Missing token or channelId in config. Skipping Discord initialization.');
            return;
        }

        this.client = new Client({ intents: [GatewayIntentBits.Guilds] });

        this.client.once('ready', async () => {
            console.log(`[Discord] Logged in as ${this.client.user.tag}`);
            try {
                const channel = await this.client.channels.fetch(this.config.discord.channelId);
                if (!channel) {
                    console.log('[Discord] Channel not found.');
                    return;
                }

                try {
                    const guild = channel.guild;
                    if (guild) {
                        await guild.commands.set([
                            {
                                name: 'efly',
                                description: 'Control the Elytra bot',
                                options: [
                                    {
                                        name: 'fly',
                                        description: 'Flight controls',
                                        type: 2,
                                        options: [
                                            { name: 'start', type: 1, description: 'Start elytra flight' },
                                            { name: 'stop', type: 1, description: 'Stop elytra flight' },
                                            {
                                                name: 'speed',
                                                type: 1,
                                                description: 'Set horizontal speed',
                                                options: [{ name: 'value', type: 10, required: true, description: 'Speed in blocks/tick' }]
                                            },
                                            {
                                                name: 'vspeed',
                                                type: 1,
                                                description: 'Set vertical speed multiplier',
                                                options: [{ name: 'value', type: 10, required: true, description: 'Vertical speed value' }]
                                            },
                                            {
                                                name: 'fall',
                                                type: 1,
                                                description: 'Set fall multiplier',
                                                options: [{ name: 'value', type: 10, required: true, description: 'Fall multiplier value' }]
                                            },
                                            { name: 'status', type: 1, description: 'Show flight status' }
                                        ]
                                    },
                                    {
                                        name: 'waypoint',
                                        description: 'Waypoint controls',
                                        type: 2,
                                        options: [
                                            {
                                                name: 'add',
                                                type: 1,
                                                description: 'Add a waypoint',
                                                options: [
                                                    { name: 'name', type: 3, required: true, description: 'Waypoint name' },
                                                    { name: 'x', type: 10, required: true, description: 'X coordinate' },
                                                    { name: 'z', type: 10, required: true, description: 'Z coordinate' },
                                                    {
                                                        name: 'dimension',
                                                        type: 3,
                                                        required: true,
                                                        description: 'World dimension',
                                                        choices: [
                                                            { name: 'Overworld', value: 'minecraft:overworld' },
                                                            { name: 'Nether', value: 'minecraft:the_nether' },
                                                            { name: 'End', value: 'minecraft:the_end' }
                                                        ]
                                                    }
                                                ]
                                            },
                                            {
                                                name: 'del',
                                                type: 1,
                                                description: 'Delete a waypoint',
                                                options: [{ name: 'name', type: 3, required: true, description: 'Waypoint name' }]
                                            },
                                            { name: 'list', type: 1, description: 'List waypoints' },
                                            {
                                                name: 'goto',
                                                type: 1,
                                                description: 'Fly to waypoint',
                                                options: [{ name: 'name', type: 3, required: true, description: 'Waypoint name' }]
                                            }
                                        ]
                                    },
                                    {
                                        name: 'tpa',
                                        description: 'Send /tpa to a player',
                                        type: 1,
                                        options: [{ name: 'user', type: 3, description: 'Minecraft username', required: true }]
                                    },
                                    { name: 'status', type: 1, description: 'Update status embed' },
                                    { name: 'help', type: 1, description: 'Show command summary' }
                                ]
                            }
                        ]);
                        console.log('[Discord] Commands registered in guild.');
                    }
                } catch (err) {
                    console.log('[Discord] Failed to register commands:', err.message);
                }

                await this.ensureStatusMessage(channel);

                this.startUpdateLoop();
            } catch (err) {
                console.log('[Discord] Ready handler error:', err.message);
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                if (interaction.customId === INPUT_BUTTON_ID) {
                    await this.handleInputButton(interaction);
                }
                return;
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === INPUT_MODAL_ID) {
                    await this.handleModalInput(interaction);
                }
                return;
            }

            if (!interaction.isChatInputCommand()) return;
            if (interaction.commandName !== 'efly') return;
            const group = interaction.options.getSubcommandGroup(false);
            const sub = interaction.options.getSubcommand();

            const mapping = this.mapInteractionToRouterCommand(interaction, group, sub);
            if (!mapping) {
                await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
                return;
            }
            await this.executeRouterInteraction(interaction, mapping);
        });

        this.client.login(this.config.discord.token).catch(err => console.log('[Discord] Login failed:', err.message));
    }

    destroy() {
        this.destroyed = true;
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        this.detachBotListeners();
        if (this.themeManager && typeof this.themeManager.off === 'function') {
            this.themeManager.off('change', this.handleThemeChange);
        }
        if (this.client) this.client.destroy();
        console.log('[Discord] Module destroyed.');
    }

    detachBotListeners() {
        if (!this.bot) return;
        this.removeBotListener('message', this.handleBotChat);
        this.removeBotListener('spawn', this.handleBotSpawn);
        this.removeBotListener('end', this.handleBotEnd);
    }

    removeBotListener(event, handler) {
        if (!this.bot || !handler) return;
        if (typeof this.bot.off === 'function') {
            this.bot.off(event, handler);
        } else if (typeof this.bot.removeListener === 'function') {
            this.bot.removeListener(event, handler);
        }
    }

    mapInteractionToRouterCommand(interaction, group, sub) {
        if (!sub) return null;
        if (group === 'fly') {
            const args = [sub];
            if (['speed', 'vspeed', 'fall'].includes(sub)) {
                const value = interaction.options.getNumber('value');
                if (typeof value !== 'number') return null;
                args.push(String(value));
            }
            return { command: 'fly', args };
        }
        if (group === 'waypoint') {
            if (sub === 'add') {
                const name = interaction.options.getString('name');
                const x = interaction.options.getNumber('x');
                const z = interaction.options.getNumber('z');
                const dimension = interaction.options.getString('dimension');
                if (!name || typeof x !== 'number' || typeof z !== 'number' || !dimension) {
                    return null;
                }
                return {
                    command: 'wp',
                    args: ['add', name, Math.round(x).toString(), Math.round(z).toString(), dimension]
                };
            }
            if (sub === 'del') {
                const name = interaction.options.getString('name');
                if (!name) return null;
                return { command: 'wp', args: ['del', name] };
            }
            if (sub === 'list') {
                return { command: 'wp', args: ['list'] };
            }
            if (sub === 'goto') {
                const name = interaction.options.getString('name');
                if (!name) return null;
                return { command: 'wp', args: ['goto', name] };
            }
            return null;
        }
        if (!group) {
            if (sub === 'tpa') {
                const user = interaction.options.getString('user');
                if (!user) return null;
                return { command: 'tpa', args: [user] };
            }
            if (sub === 'status') {
                return { command: 'status', args: [], postAction: () => this.updateEmbed() };
            }
            if (sub === 'help') {
                return { command: 'help', args: [] };
            }
        }
        return null;
    }

    async executeRouterInteraction(interaction, mapping) {
        const respond = this.createInteractionResponder(interaction);
        const context = this.buildRouterContext(respond, this.getInteractionUsername(interaction));
        try {
            const result = await this.commandRouter.executeCommand(mapping.command, mapping.args || [], context);
            if (!result.ok) {
                const errMessage = result.error instanceof Error ? result.error.message : result.error;
                respond(errMessage || 'Command failed.');
                return;
            }
            if (typeof mapping.postAction === 'function') {
                await mapping.postAction();
            }
        } catch (err) {
            console.log('[Discord] Router command error:', err);
            respond('Error executing command.');
        }
    }

    createInteractionResponder(interaction) {
        let replied = false;
        const responder = (message) => {
            if (!message) return;
            const payload = {
                content: typeof message === 'string' ? message : String(message),
                ephemeral: true
            };
            if (!replied) {
                replied = true;
                interaction.reply(payload).catch(() => {});
            } else {
                interaction.followUp(payload).catch(() => {});
            }
        };
        responder.wasUsed = () => replied;
        return responder;
    }

    buildRouterContext(respond, username) {
        return {
            respond,
            getBot: () => this.bot,
            getElytraFly: () => this.elytraFly,
            getCommander: () => this.commander,
            accessControl: this.accessControl,
            logger: this.logger,
            themeManager: this.themeManager,
            initiator: {
                type: 'discord',
                username: username || 'discord-user'
            }
        };
    }

    getInteractionUsername(interaction) {
        return interaction?.user?.tag || interaction?.user?.username || 'discord-user';
    }

    async handleInputButton(interaction) {
        if (interaction.customId !== INPUT_BUTTON_ID) return;
        const modal = new ModalBuilder()
            .setCustomId(INPUT_MODAL_ID)
            .setTitle('FlightBot Input');
        const input = new TextInputBuilder()
            .setCustomId(INPUT_FIELD_ID)
            .setLabel('Type a command or chat line')
            .setPlaceholder('.help or hello world')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(256);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        try {
            await interaction.showModal(modal);
        } catch (err) {
            this.forwardSystemLog?.('[Discord] Failed to open modal: ' + err.message, 'red');
        }
    }

    async handleModalInput(interaction) {
        if (interaction.customId !== INPUT_MODAL_ID) return;
        const raw = (interaction.fields.getTextInputValue(INPUT_FIELD_ID) || '').trim();
        if (!raw) {
            await interaction.reply({ content: 'Nothing entered.', ephemeral: true }).catch(() => {});
            return;
        }

        const prefix = this.commandRouter.prefix || '.';
        if (raw.startsWith(prefix)) {
            const respond = this.createInteractionResponder(interaction);
            const context = this.buildRouterContext(respond, this.getInteractionUsername(interaction));
            try {
                const result = await this.commandRouter.execute(raw, context);
                if (typeof respond.wasUsed !== 'function' || !respond.wasUsed()) {
                    if (result.ok) {
                        respond('Command sent.');
                    } else {
                        const errMessage = result.error instanceof Error ? result.error.message : result.error;
                        respond(errMessage || 'Command failed.');
                    }
                }
            } catch (err) {
                respond('Error executing command.');
            }
            await this.updateEmbed();
            return;
        }

        const bot = this.bot;
        if (!bot || typeof bot.chat !== 'function') {
            await interaction.reply({ content: 'Bot not ready yet.', ephemeral: true }).catch(() => {});
            return;
        }
        bot.chat(raw);
        this.appendChatLog(`<You> ${raw}`);
        if (typeof this.logChatMessage === 'function') {
            this.logChatMessage(`<Discord> ${raw}`, 'magenta');
        }
        await interaction.reply({ content: 'Sent chat message.', ephemeral: true }).catch(() => {});
        await this.updateEmbed();
    }


    async handleArrival(waypointName) {
        if (this.destroyed || !this.client || !this.client.isReady()) return;
        this.arrivedFlag = true;
        this.arrivedWaypointName = waypointName || null;
        await this.updateEmbed();
        try {
            const channel = await this.client.channels.fetch(this.config.discord.channelId);
            if (!channel) return;
            const msg = await channel.send({
                content: `@everyone 🎉 Arrived${waypointName ? ` at ${waypointName}` : ''}! 🎉`,
                allowedMentions: { parse: ['everyone'] }
            });
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        } catch (err) {
            console.log('[Discord] Arrival announcement failed:', err.message);
        }
    }

    startUpdateLoop() {
        if (this.destroyed) return;
        const interval = this.getUpdateIntervalMs();
        this.updateTimer = setTimeout(async () => {
            if (this.destroyed) return;
            await this.updateEmbed();
            this.startUpdateLoop();
        }, interval);
    }

    loadInitialConfig() {
        const snapshot = this.getConfigSnapshot(true);
        return snapshot || {};
    }

    getConfigSnapshot(logErrors = false) {
        const fromFile = this.readConfigFromFile(logErrors);
        if (fromFile) {
            return fromFile;
        }
        if (typeof this.getConfigFn === 'function') {
            const current = this.getConfigFn();
            return current ? this.cloneConfig(current) : {};
        }
        return this.cloneConfig(this.config || {});
    }

    readConfigFromFile(logErrors = false) {
        if (!this.configPath) return null;
        try {
            const raw = fs.readFileSync(this.configPath, 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (logErrors) {
                this.forwardSystemLog?.('[Discord] Failed to read config: ' + err.message, 'red');
            }
            return null;
        }
    }

    async persistDiscordPatch(patch = {}) {
        if (!patch || !Object.keys(patch).length) return;
        const base = this.getConfigSnapshot();
        const next = {
            ...base,
            discord: { ...(base.discord || {}), ...patch }
        };
        if (this.saveConfigFn) {
            try {
                await this.saveConfigFn(next);
                this.config = this.cloneConfig(next);
            } catch (err) {
                this.forwardSystemLog?.('[Discord] Failed to persist config: ' + err.message, 'red');
            }
            return;
        }
        if (!this.configPath) return;
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(next, null, 4));
            this.config = next;
        } catch (err) {
            this.forwardSystemLog?.('[Discord] Failed to save config: ' + err.message, 'red');
        }
    }

    updateConfig(nextConfig) {
        if (!nextConfig || typeof nextConfig !== 'object') return;
        this.config = this.cloneConfig(nextConfig);
    }

    cloneConfig(source) {
        try {
            return JSON.parse(JSON.stringify(source));
        } catch (_) {
            return { ...source };
        }
    }

    async ensureStatusMessage(channel) {
        const discordCfg = this.config.discord || {};
        const msgId = discordCfg.statusMessageId ? discordCfg.statusMessageId : null;
        if (msgId) {
            try {
                const msg = await channel.messages.fetch(msgId);
                if (msg) {
                    await msg.edit(this.buildDiscordPayload()).catch(() => {});
                    return msg;
                }
            } catch (err) {
                console.log('[Discord] Previous status message not found, sending a new one.');
            }
        }

        const payload = this.buildDiscordPayload();
        const sent = await channel.send(payload);
        await this.persistDiscordPatch({ statusMessageId: sent.id });
        return sent;
    }

    async updateEmbed() {
        if (this.destroyed || !this.client || !this.client.isReady()) return;

        if (this.elytraFly && this.elytraFly.target) {
            this.arrivedFlag = false;
            this.arrivedWaypointName = null;
        }

        this.updateFlightMetrics();

        try {
            const channel = await this.client.channels.fetch(this.config.discord.channelId);
            if (!channel) return;
            const discordCfg = this.config.discord || {};
            const msgId = discordCfg.statusMessageId;
            const payload = this.buildDiscordPayload();
            if (!msgId) {
                await this.ensureStatusMessage(channel);
                return;
            }
            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (msg) {
                await msg.edit(payload);
            } else {
                const sent = await channel.send(payload);
                await this.persistDiscordPatch({ statusMessageId: sent.id });
            }
        } catch (err) {
            console.log('[Discord] updateEmbed error:', err.message);
        }
    }

    updateFlightMetrics() {
        if (!this.bot || !this.bot.entity) return;
        const now = Date.now();
        const pos = this.bot.entity.position;
        if (this.lastTime && this.lastPos) {
            const timeDiff = (now - this.lastTime) / 1000;
            if (timeDiff > 0) {
                const dx = pos.x - this.lastPos.x;
                const dz = pos.z - this.lastPos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                this.currentBps = (dist / timeDiff).toFixed(1);
            }
        }
        this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
        this.lastTime = now;
    }

    buildDiscordPayload() {
        return {
            embeds: this.buildEmbeds(),
            components: this.buildInputComponents()
        };
    }

    buildEmbeds() {
        const panelConfig = this.themeManager && typeof this.themeManager.getActivePanels === 'function'
            ? this.themeManager.getActivePanels()
            : {};
        const serverEmbed = this.buildServerEmbed(panelConfig?.server || {});
        const flightEmbed = this.buildFlightEmbed(panelConfig?.status || {});
        const chatEmbed = this.buildChatEmbed(panelConfig?.chat || {});
        return [serverEmbed, flightEmbed, chatEmbed].filter(Boolean);
    }

    buildServerEmbed(theme = {}) {
        const embed = new EmbedBuilder()
            .setTitle(this.getPanelTitle(theme, 'Server'))
            .setColor(this.resolvePanelColor(theme, '#5865f2'))
            .setTimestamp(new Date());

        const players = getOnlinePlayers(this.bot);
        embed.addFields(
            { name: 'IP', value: this.getHostLabel(), inline: true },
            { name: 'Online', value: this.getUptimeLabel(), inline: true },
            { name: 'Players', value: String(players.length || 0), inline: true }
        );

        embed.setDescription(this.formatPlayersGrid(players));
        return embed;
    }

    buildFlightEmbed(theme = {}) {
        const embed = new EmbedBuilder()
            .setTitle(this.getPanelTitle(theme, 'Flight Status'))
            .setColor(this.resolvePanelColor(theme, '#2ecc71'))
            .setTimestamp(new Date());

        const botReady = !!(this.bot && this.bot.entity);
        const health = this.bot && typeof this.bot.health === 'number' ? `${this.bot.health.toFixed(1)}/20` : 'N/A';
        const speed = `${this.currentBps || 0} b/s`;
        const destination = this.getFlightDestination();
        const eta = this.getEtaLabel();

        embed.addFields(
            { name: 'Connected', value: botReady ? 'Yes' : 'No', inline: true },
            { name: 'Dimension', value: this.getDimensionLabel(), inline: true },
            { name: 'Health', value: health, inline: true },
            { name: 'Coords', value: this.getCoordinateLabel(), inline: false },
            { name: 'Speed', value: speed, inline: true },
            { name: 'Flight', value: this.elytraFly && this.elytraFly.active ? 'Active' : 'Idle', inline: true },
            { name: 'Destination', value: destination, inline: true },
            { name: 'ETA', value: eta, inline: true }
        );

        return embed;
    }

    buildChatEmbed(theme = {}) {
        const embed = new EmbedBuilder()
            .setTitle(this.getPanelTitle(theme, 'Chat'))
            .setColor(this.resolvePanelColor(theme, '#f1c40f'))
            .setTimestamp(new Date());

        const entries = this.chatLog.length
            ? this.chatLog.slice(-8)
            : [{ text: '_waiting for chat..._' }];
        const lines = entries.map(entry => `• ${entry.text}`);
        const description = truncateText(lines.join('\n'), 1900);
        embed.setDescription(description);
        if (theme.subtitle) {
            embed.setFooter({ text: theme.subtitle });
        }
        return embed;
    }

    buildInputComponents() {
        const button = new ButtonBuilder()
            .setCustomId(INPUT_BUTTON_ID)
            .setLabel('Open Input')
            .setStyle(ButtonStyle.Primary);
        return [new ActionRowBuilder().addComponents(button)];
    }

    getPanelTitle(theme = {}, fallback = '') {
        if (Array.isArray(theme.titleSegments) && theme.titleSegments.length) {
            const combined = theme.titleSegments.map(seg => seg?.text || '').join('').trim();
            if (combined) return combined;
        }
        return theme.title || fallback;
    }

    resolvePanelColor(theme = {}, fallbackHex = '#5865f2') {
        const source = theme.defaultColor || theme.textColor || fallbackHex;
        return hexToColorInt(source, hexToColorInt(fallbackHex));
    }

    getHostLabel() {
        const cfg = this.config.minecraft || {};
        const botOptions = this.bot?.options || {};
        const host = cfg.host || botOptions.host || 'N/A';
        const port = cfg.port ?? botOptions.port;
        if (port && port !== 25565) {
            return `${host}:${port}`;
        }
        return host;
    }

    getUptimeLabel() {
        if (!this.connectedAt) return 'Offline';
        return formatDuration(Date.now() - this.connectedAt);
    }

    getDimensionLabel() {
        if (!this.bot || !this.bot.game || !this.bot.game.dimension) return 'N/A';
        return this.bot.game.dimension.replace('minecraft:', '');
    }

    getCoordinateLabel() {
        if (!this.bot || !this.bot.entity || !this.bot.entity.position) return 'N/A';
        const pos = this.bot.entity.position;
        return `X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)}`;
    }

    getFlightDestination() {
        if (this.elytraFly && this.elytraFly.target) {
            const target = this.elytraFly.target;
            if (this.elytraFly.currentWaypointName) {
                return `${this.elytraFly.currentWaypointName} (${Math.round(target.x)}, ${Math.round(target.z)})`;
            }
            return `X:${Math.round(target.x)} Z:${Math.round(target.z)}`;
        }
        if (this.arrivedFlag) {
            return this.arrivedWaypointName ? `Arrived • ${this.arrivedWaypointName}` : 'Arrived 🎉';
        }
        return 'Idle';
    }

    getEtaLabel() {
        if (!this.bot || !this.bot.entity) {
            return 'N/A';
        }
        if ((!this.elytraFly || !this.elytraFly.target) && this.arrivedFlag) {
            return 'ARRIVED 🎉';
        }
        if (!this.elytraFly || !this.elytraFly.target) {
            return 'N/A';
        }
        const pos = this.bot.entity.position;
        const dx = pos.x - this.elytraFly.target.x;
        const dz = pos.z - this.elytraFly.target.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        return computeEta(dist, this.bot.entity.velocity) || 'N/A';
    }

    formatPlayersGrid(players = []) {
        if (!players.length) {
            return '_no players online_';
        }
        const sanitized = players.map(name => truncateText((name || 'unknown'), 20));
        const columnWidth = 18;
        const rows = [];
        for (let i = 0; i < sanitized.length; i += 2) {
            const left = sanitized[i] || '';
            const right = sanitized[i + 1] || '';
            if (right) {
                rows.push(`${left.padEnd(columnWidth, ' ')} ${right}`.trimEnd());
            } else {
                rows.push(left);
            }
        }
        const grid = rows.join('\n');
        return `\`\`\`\n${grid}\n\`\`\``;
    }

    getUpdateIntervalMs() {
        const desired = Number(this.config?.discord?.updateInterval);
        if (Number.isFinite(desired) && desired > 0) {
            return Math.max(DISCORD_UPDATE_MIN_INTERVAL, desired);
        }
        return DISCORD_UPDATE_MIN_INTERVAL;
    }

    handleBotChat(jsonMsg) {
        if (this.destroyed) return;
        try {
            const segments = parseChatSegments(jsonMsg) || [];
            const text = segmentsToPlainText(segments);
            if (text) {
                this.appendChatLog(text);
            }
        } catch (_) {
            // ignore malformed chat payloads
        }
    }

    handleBotSpawn() {
        this.connectedAt = Date.now();
    }

    handleBotEnd() {
        this.connectedAt = null;
    }

    handleThemeChange() {
        this.updateEmbed().catch(err => {
            console.log('[Discord] Theme sync failed:', err.message);
        });
    }

    appendChatLog(text) {
        const sanitized = escapeDiscordMarkdown(String(text || '').trim());
        if (!sanitized) return;
        this.chatLog.push({ text: sanitized, ts: Date.now() });
        if (this.chatLog.length > CHAT_HISTORY_LIMIT) {
            this.chatLog.splice(0, this.chatLog.length - CHAT_HISTORY_LIMIT);
        }
    }
}

module.exports = DiscordModule;

function hexToColorInt(hex, fallback = 0x5865f2) {
    if (typeof hex !== 'string') return fallback;
    const value = parseInt(hex.replace(/[^a-fA-F0-9]/g, ''), 16);
    return Number.isFinite(value) ? value : fallback;
}

function escapeDiscordMarkdown(text) {
    return text
        .replace(/[`*_~|]/g, '\\$&')
        .replace(/@/g, '@\u200b');
}

function truncateText(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function segmentsToPlainText(segments) {
    if (!Array.isArray(segments) || !segments.length) return '';
    return segments.map(seg => seg?.text || '').join('');
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds >= 3600) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
    if (totalSeconds >= 60) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }
    return `${totalSeconds}s`;
}
