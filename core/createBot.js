const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const path = require('path');
const ElytraFly = require('../modules/efly');
const TpaModule = require('../modules/tpa');
const AutoTunnel = require('../modules/autoTunnel');
const Commander = require('../modules/commander');
const { parseChatSegments } = require('../lib/chatParser');

function createBotManager({
    options,
    files,
    getConfig,
    saveConfig,
    logChatMessage,
    forwardSystemLog,
    commandRouter,
    accessControl,
    logger,
    themeManager
}) {
    if (!options) throw new Error('createBotManager requires options');
    const rootDir = path.resolve(__dirname, '..');
    const resolvedFiles = {
        state: files?.state || path.join(rootDir, 'data', 'state.json'),
        waypoints: files?.waypoints || path.join(rootDir, 'data', 'waypoints.json'),
        config: files?.config || path.join(rootDir, 'config', 'config.json')
    };

    if (!accessControl) {
        throw new Error('createBotManager requires accessControl');
    }
    if (!logger) {
        throw new Error('createBotManager requires logger');
    }

    let bot = null;
    let elytraFly = null;
    let tpaModule = null;
    let autoTunnel = null;
    let commander = null;
    let discordModule = null;
    let connectedAt = null;
    let shouldReconnect = true;
    const trackedPlayers = new Set();

    function updateFlightConfig(patch = {}) {
        if (typeof saveConfig !== 'function') return Promise.resolve();
        const current = getConfig?.() || {};
        const next = {
            ...current,
            flight: { ...current.flight, ...patch }
        };
        return saveConfig(next).catch(err => {
            forwardSystemLog?.('[Config] Failed to persist flight config: ' + err.message, 'red');
        });
    }

    function start() {
        spawnBot();
    }

    function spawnBot() {
        trackedPlayers.clear();
        bot = mineflayer.createBot(options);
        bot.loadPlugin(pathfinder);

        const flightAdapter = {
            getFlightConfig: () => (getConfig?.().flight || {}),
            saveFlightConfig: (patch) => updateFlightConfig(patch)
        };

        elytraFly = new ElytraFly(bot, resolvedFiles.state, flightAdapter);
        elytraFly.applyFlightConfig(getConfig?.().flight);
        tpaModule = new TpaModule(bot, accessControl, logger);
        autoTunnel = new AutoTunnel(bot, {
            logger,
            forwardSystemLog
        });
        commander = new Commander(bot, elytraFly, accessControl, resolvedFiles.waypoints, {
            commandRouter,
            forwardSystemLog,
            logger,
            themeManager,
            getAutoTunnel: () => autoTunnel
        });

        bot.on('spawn', () => {
            connectedAt = Date.now();
            forwardSystemLog?.('Bot spawned!');
            
            try {
                const mcData = require('minecraft-data')(bot.version);
                const movements = new Movements(bot, mcData);
                bot.pathfinder.setMovements(movements);
            } catch (err) {
                forwardSystemLog?.('[Pathfinder] Failed to setup movements: ' + err.message, 'yellow');
            }
            
            setTimeout(async () => {
                try {
                    await elytraFly.resume();
                } catch (err) {
                    forwardSystemLog?.('[Bot] Failed to resume flight: ' + err.message, 'red');
                }
                await elytraFly.ensureHovering();
            }, 1000);
        });

        bot.on('message', (jsonMsg) => {
            const segments = parseChatSegments(jsonMsg);
            logChatMessage?.(segments);
        });

        bot.on('entitySpawn', (entity) => handleEntityVisibility(entity, 'enter'));
        bot.on('entityGone', (entity) => handleEntityVisibility(entity, 'leave'));

        bot.on('health', () => {
            const config = getConfig?.() || {};
            const safety = config.safety || {};
            const minHealth = safety.minHealth ?? 5;
            const disconnectOnLowHealth = safety.disconnectOnLowHealth !== undefined ? safety.disconnectOnLowHealth : true;
            if (disconnectOnLowHealth && bot.health <= minHealth) {
                forwardSystemLog?.('[SAFETY] Health critical! Disconnecting...');
                shouldReconnect = false;
                bot.quit();
            }
        });

        bot.on('physicsTick', () => {
            const config = getConfig?.() || {};
            const safety = config.safety || {};
            const disconnectOnArrival = safety.disconnectOnArrival !== undefined ? safety.disconnectOnArrival : true;
            const disconnectRadius = safety.disconnectRadius ?? 2000;
            if (!bot.entity || !disconnectOnArrival || !elytraFly || !elytraFly.active || !elytraFly.target) return;
            const pos = bot.entity.position;
            const dx = pos.x - elytraFly.target.x;
            const dz = pos.z - elytraFly.target.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < disconnectRadius) {
                const waypointName = elytraFly.currentWaypointName;
                const label = waypointName ? `waypoint "${waypointName}"` : 'target';
                forwardSystemLog?.(`[SAFETY] Arrived near ${label} (Distance: ${Math.round(dist)}). Entering hover mode.`);
                elytraFly.enterHoverMode('arrival');
                elytraFly.ensureHovering().catch(err => forwardSystemLog?.('[SAFETY] Hover mode failed: ' + err.message, 'red'));
                if (discordModule && typeof discordModule.handleArrival === 'function') {
                    discordModule.handleArrival(waypointName).catch(err => forwardSystemLog?.('[Discord] Arrival notify failed: ' + err.message, 'red'));
                }
            }
        });

        bot.on('end', (reason) => {
            forwardSystemLog?.(`Bot disconnected: ${reason}`);
            connectedAt = null;
            trackedPlayers.clear();
            destroyDiscord();
            if (elytraFly) {
                elytraFly.stop();
            }
            if (shouldReconnect) {
                forwardSystemLog?.('Reconnecting in 5 seconds...');
                setTimeout(spawnBot, 5000);
            } else {
                forwardSystemLog?.('Bot finished. Exiting process.');
                process.exit(0);
            }
        });

        bot.on('error', (err) => forwardSystemLog?.(`Error: ${err.message}`, 'red'));
        bot.on('kicked', (reason) => {
            let reasonStr;
            if (typeof reason === 'string') {
                reasonStr = reason;
            } else if (reason && typeof reason === 'object') {
                reasonStr = reason.text || reason.translate || JSON.stringify(reason);
            } else {
                reasonStr = String(reason);
            }
            forwardSystemLog?.(`Kicked: ${reasonStr}`, 'red');
        });

        try {
            const DiscordModule = require('../modules/discord');
            const config = getConfig?.() || {};
            if (config.discord && config.discord.token && config.discord.channelId) {
                discordModule = new DiscordModule(bot, elytraFly, commander, resolvedFiles.config, {
                    commandRouter,
                    forwardSystemLog,
                    accessControl,
                    logger,
                    getConfig,
                    saveConfig,
                    themeManager,
                    logChatMessage
                });
                if (discordModule && typeof discordModule.updateConfig === 'function') {
                    discordModule.updateConfig(config);
                }
            } else {
                forwardSystemLog?.('[Discord] Token or channelId not set in config/config.json; Discord integration disabled.');
            }
        } catch (e) {
            forwardSystemLog?.('[Discord] Discord module not available or failed to load: ' + e.message, 'red');
        }
    }

    function handleEntityVisibility(entity, action) {
        if (!entity || entity.type !== 'player' || !entity.username) return;
        if (!bot || entity.username === bot.username) return;
        const key = (entity.uuid || entity.username).toLowerCase();
        if (action === 'enter') {
            if (trackedPlayers.has(key)) return;
            trackedPlayers.add(key);
        } else if (action === 'leave') {
            if (!trackedPlayers.has(key)) return;
            trackedPlayers.delete(key);
        }
        logger?.logPlayerRange({
            action,
            username: entity.username,
            uuid: entity.uuid || null
        });
    }

    function destroyDiscord() {
        if (!discordModule) return;
        try {
            discordModule.destroy();
        } catch (err) {
            forwardSystemLog?.('Error destroying Discord module: ' + err.message, 'red');
        } finally {
            discordModule = null;
        }
    }

    function requestShutdown({ reconnect = false, reason = 'manual quit', forceExit = false } = {}) {
        shouldReconnect = reconnect;
        if (bot) {
            bot.quit(reason);
        }
        if (!reconnect && forceExit) {
            process.exit(0);
        }
    }

    function applyConfig(nextConfig) {
        if (elytraFly && nextConfig?.flight) {
            elytraFly.applyFlightConfig(nextConfig.flight);
        }
        if (discordModule && typeof discordModule.updateConfig === 'function') {
            discordModule.updateConfig(nextConfig);
        }
    }

    return {
        start,
        requestShutdown,
        getBot: () => bot,
        getElytraFly: () => elytraFly,
        getAutoTunnel: () => autoTunnel,
        getCommander: () => commander,
        getConnectedAt: () => connectedAt,
        isReconnectEnabled: () => shouldReconnect,
        setReconnectEnabled: flag => { shouldReconnect = !!flag; },
        applyConfig
    };
}

module.exports = {
    createBotManager
};
