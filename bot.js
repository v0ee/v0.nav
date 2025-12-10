process.env.COLORTERM = process.env.COLORTERM || 'truecolor';
process.env.TERM = process.env.TERM || 'xterm-256color';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
    initCli,
    setConsoleHandlers,
    logChatMessage,
    forwardSystemLog,
    updateUiStatus,
    updateServerInfo
} = require('./cli');
const { loadConfig, watchConfig, saveConfig } = require('./lib/config');
const { createCliHandler } = require('./cli/handler');
const { createStatusPanel } = require('./lib/statusPanel');
const { createCommandRouter } = require('./lib/commandRouter');
const { SessionLogger } = require('./lib/logger');
const { AccessControl } = require('./modules/accessControl');
const { createThemeManager } = require('./lib/themeManager');
const { createInstanceManager } = require('./lib/instanceManager');
const { createMultiBotManager } = require('./lib/multiBotManager');
const updateManager = require('./lib/updateManager');

const UI_REFRESH_MS = 1500;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

main().catch(err => {
    originalConsoleError('v0.nav failed to start:', err);
    process.exit(1);
});

async function main() {
    const ready = await ensureFirstTimeSetup();
    if (!ready) {
        return;
    }

    startFlightBot();
}

function startFlightBot() {
    setConsoleHandlers(originalConsoleLog, originalConsoleError);

    const instanceManager = createInstanceManager({
        filePath: path.join(__dirname, 'config', 'instances.json')
    });
    instanceManager.loadSync();

    const cfgPath = path.join(__dirname, 'config', 'config.json');
    let config = loadConfig(cfgPath);

    const logger = new SessionLogger({ directory: path.resolve(__dirname, config.logging?.directory || 'logs') });
    const accessControl = new AccessControl({
        filePath: path.join(__dirname, 'data', 'whitelist.json'),
        legacyFile: path.join(__dirname, 'white.list'),
        ownerUuid: config.ownerUuid,
        logger
    });
    const themeManager = createThemeManager({ filePath: path.join(__dirname, 'config', 'themes.json') });
    let stopConfigWatch = () => {};

    const commandRouter = createCommandRouter({
        prefix: '.',
        commandsDir: path.join(__dirname, 'commands'),
        logger
    });

    const multiBotManager = createMultiBotManager({
        rootDir: __dirname,
        logger,
        accessControl,
        themeManager,
        commandRouter,
        logChatMessage,
        forwardSystemLog,
        baseConfig: config,
        saveConfig: (nextConfig) => saveConfig(cfgPath, nextConfig),
        instanceManager 
    });

    const statusPanel = createStatusPanel({
        options: config.minecraft,
        updateUiStatus,
        updateServerInfo
    });

    function refreshStatus() {
        const activeEntry = multiBotManager.getActiveEntry();
        const runningInstances = multiBotManager.getStatusInfo();
        
        statusPanel.refresh({
            bot: activeEntry?.botManager?.getBot() || null,
            elytraFly: activeEntry?.botManager?.getElytraFly() || null,
            autoTunnel: activeEntry?.botManager?.getAutoTunnel() || null,
            connectedAt: activeEntry?.botManager?.getConnectedAt() || null,
            instanceName: activeEntry?.instance?.name || 'None',
            runningCount: runningInstances.length,
            runningInstances
        });
    }

    stopConfigWatch = watchConfig(cfgPath, next => {
        config = next;
        accessControl.setOwnerUuid(config.ownerUuid);
        forwardSystemLog('Config reloaded.');
    });

    const refreshInterval = setInterval(refreshStatus, UI_REFRESH_MS);
    refreshStatus();

    function handleInstanceStart(instance) {
        forwardSystemLog(`Starting instance: ${instance.name} (${instance.minecraft?.host})...`, 'cyan');
        multiBotManager.startInstance(instance);
    }

    function handleInstanceStop(instanceId) {
        multiBotManager.stopInstance(instanceId);
    }

    function handleSetActiveInstance(instanceId) {
        if (multiBotManager.setActiveInstance(instanceId)) {
            const entry = multiBotManager.getActiveEntry();
            forwardSystemLog(`Active instance set to: ${entry?.instance?.name || instanceId}`, 'green');
        }
    }

    const cliHandler = createCliHandler({
        commandRouter,
        forwardSystemLog,
        logChatMessage,
        getBot: () => multiBotManager.getActiveBot(),
        getElytraFly: () => multiBotManager.getActiveBotManager()?.getElytraFly() || null,
        getAutoTunnel: () => multiBotManager.getActiveBotManager()?.getAutoTunnel() || null,
        getAutoTotem: () => multiBotManager.getActiveBotManager()?.getAutoTotem() || null,
        getAutoArmor: () => multiBotManager.getActiveBotManager()?.getAutoArmor() || null,
        getAutoEat: () => multiBotManager.getActiveBotManager()?.getAutoEat() || null,
        getCommander: () => multiBotManager.getActiveBotManager()?.getCommander() || null,
        accessControl,
        logger,
        refreshStatus,
        requestShutdown: (opts) => {
            if (opts?.forceExit) {
                multiBotManager.stopAll('shutdown');
                setTimeout(() => process.exit(0), 500);
            } else {
                const activeId = multiBotManager.getActiveInstanceId();
                if (activeId) {
                    multiBotManager.stopInstance(activeId, opts?.reason || 'manual quit');
                }
            }
        },
        themeManager,
        instanceManager,
        multiBotManager,
        onInstanceStart: handleInstanceStart,
        onInstanceStop: handleInstanceStop
    });

    initCli({
        onSubmit: cliHandler.handleUserInput,
        onCtrlC: () => {
            multiBotManager.stopAll('shutdown');
            setTimeout(() => process.exit(0), 500);
        },
        themeManager,
        instanceManager,
        multiBotManager,
        onInstanceStart: handleInstanceStart,
        onInstanceStop: handleInstanceStop,
        onSetActiveInstance: handleSetActiveInstance
    }).catch(err => {
        originalConsoleError('Failed to initialize CLI:', err);
        process.exit(1);
    });

    console.log = (...args) => forwardSystemLog(formatArgs(args), 'cyan');
    console.error = (...args) => forwardSystemLog(formatArgs(args), 'red');

    forwardSystemLog('v0.nav CLI ready. Press F2 to open Instance Manager.', 'green');
    forwardSystemLog('Type .help for commands. Start instances from the Instance Manager.', 'cyan');

    (async () => {
        try {
            const updateInfo = await updateManager.checkForUpdates({ repoPath: __dirname });
            if (updateInfo?.hasCustomCode) {
                const details = updateInfo.customCodeDetails || {};
                const files = [...new Set([...(details.workingTree || []), ...(details.committed || [])])];
                const preview = files.length ? `${files.slice(0, 2).join(', ')}${files.length > 2 ? ` (+${files.length - 2} more)` : ''}` : 'custom code changes';
                forwardSystemLog(`[Update] Custom code detected (${preview}). You're running a custom v0.nav build and support isn't guaranteed.`, 'magenta');
            }
            if (updateInfo?.status === 'behind') {
                const warn = `[Update] A new version (${updateInfo.remoteHash}) is available. Run .update for the best experience.`;
                forwardSystemLog(warn, 'yellow');
            }
        } catch (err) {
            forwardSystemLog(`[Update] Failed to check for updates: ${err.message}`, 'red');
        }

        const restored = await multiBotManager.restorePreviousSession();
        if (!restored) {
            const firstInstance = instanceManager.getActiveInstance() || instanceManager.getInstances()[0];
            if (firstInstance) {
                forwardSystemLog(`Auto-starting instance: ${firstInstance.name}...`, 'cyan');
                multiBotManager.startInstance(firstInstance);
            }
        }
    })();

    process.once('exit', () => {
        clearInterval(refreshInterval);
        stopConfigWatch();
        themeManager.close();
        logger.close('process-exit');
    });
}

async function ensureFirstTimeSetup() {
    const navPath = path.join(__dirname, 'data', 'v0.nav');
    try {
        await fsp.access(navPath);
        return true;
    } catch (err) {
        if (!err || err.code !== 'ENOENT') {
            throw err;
        }
    }

    const runFirstTimeSetup = require('./core/firstTime');
    const result = await runFirstTimeSetup({
        configPath: path.join(__dirname, 'config', 'config.json'),
        themesPath: path.join(__dirname, 'config', 'themes.json'),
        dataDir: path.join(__dirname, 'data')
    });

    if (!result?.launchBot) {
        originalConsoleLog('Setup finished. Re-run FlightBot whenever you are ready.');
        return false;
    }

    return true;
}

function formatArgs(args) {
    return args
        .map(arg => {
            if (typeof arg === 'string') return arg;
            try { return JSON.stringify(arg); }
            catch { return String(arg); }
        })
        .join(' ');
}
