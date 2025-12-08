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
const { createBotManager } = require('./core/createBot');
const { createCommandRouter } = require('./lib/commandRouter');
const { SessionLogger } = require('./lib/logger');
const { AccessControl } = require('./modules/accessControl');
const { createThemeManager } = require('./lib/themeManager');

const UI_REFRESH_MS = 1500;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

main().catch(err => {
    originalConsoleError('FlightBot failed to start:', err);
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

    const options = {
        ...config.minecraft,
        checkTimeoutInterval: 60000,
        closeTimeout: 120000,
        onMsaCode: (data) => {
            forwardSystemLog('========================================', 'cyan');
            forwardSystemLog('Microsoft Login Required!', 'yellow');
            forwardSystemLog(`Go to: ${data.verification_uri}`, 'cyan');
            forwardSystemLog(`Enter code: ${data.user_code}`, 'green');
            forwardSystemLog('========================================', 'cyan');
        }
    };

    const commandRouter = createCommandRouter({
        prefix: '.',
        commandsDir: path.join(__dirname, 'commands'),
        logger
    });

    const botManager = createBotManager({
        options,
        files: {
            state: path.join(__dirname, 'data', 'state.json'),
            waypoints: path.join(__dirname, 'data', 'waypoints.json'),
            config: cfgPath
        },
        getConfig: () => config,
        logChatMessage,
        forwardSystemLog,
        commandRouter,
        accessControl,
        logger,
        saveConfig: (nextConfig) => saveConfig(cfgPath, nextConfig),
        themeManager
    });

    stopConfigWatch = watchConfig(cfgPath, next => {
        config = next;
        accessControl.setOwnerUuid(config.ownerUuid);
        forwardSystemLog('Config reloaded.');
        botManager.applyConfig(config);
    });

    const statusPanel = createStatusPanel({
        options,
        updateUiStatus,
        updateServerInfo
    });

    const refreshStatus = () => {
        statusPanel.refresh({
            bot: botManager.getBot(),
            elytraFly: botManager.getElytraFly(),
            autoTunnel: botManager.getAutoTunnel(),
            connectedAt: botManager.getConnectedAt()
        });
    };

    setInterval(refreshStatus, UI_REFRESH_MS);
    refreshStatus();

    const cliHandler = createCliHandler({
        commandRouter,
        forwardSystemLog,
        logChatMessage,
        getBot: botManager.getBot,
        getElytraFly: botManager.getElytraFly,
        getAutoTunnel: botManager.getAutoTunnel,
        getCommander: botManager.getCommander,
        accessControl,
        logger,
        refreshStatus,
        requestShutdown: botManager.requestShutdown,
        themeManager
    });

    initCli({
        onSubmit: cliHandler.handleUserInput,
        onCtrlC: cliHandler.handleCliExit,
        themeManager
    }).catch(err => {
        originalConsoleError('Failed to initialize CLI:', err);
        process.exit(1);
    });

    console.log = (...args) => forwardSystemLog(formatArgs(args), 'cyan');
    console.error = (...args) => forwardSystemLog(formatArgs(args), 'red');

    forwardSystemLog('FlightBot CLI ready. Type .help for commands.');

    botManager.start();

    process.once('exit', () => {
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
