function createCliHandler({
    commandRouter,
    forwardSystemLog,
    logChatMessage,
    getBot,
    getElytraFly,
    getAutoTunnel,
    getCommander,
    accessControl,
    logger,
    refreshStatus,
    requestShutdown,
    themeManager,
    instanceManager,
    multiBotManager,
    onInstanceStart,
    onInstanceStop
}) {
    if (!commandRouter) throw new Error('CLI handler requires a command router');
    const respond = (message, color) => {
        if (typeof forwardSystemLog === 'function') {
            forwardSystemLog(message, color);
        }
    };

    async function handleUserInput(raw) {
        const trimmed = (raw || '').trim();
        if (!trimmed) return;

        const prefix = commandRouter.prefix || '.';
        if (trimmed.startsWith(prefix)) {
            const result = await commandRouter.execute(trimmed, buildCommandContext());
            if (!result.ok && result.error) {
                const errorMessage = result.error instanceof Error ? result.error.message : result.error;
                respond(errorMessage || 'Command failed.', 'red');
            }
            return;
        }

        const bot = getBot?.();
        if (bot) {
            bot.chat(trimmed);
            if (typeof logChatMessage === 'function') {
                logChatMessage(`<You> ${trimmed}`, 'yellow');
            }
        } else {
            respond('No active bot. Press F2 to start an instance.', 'red');
        }
    }

    function handleCliExit() {
        if (typeof requestShutdown === 'function') {
            requestShutdown({ reason: 'CLI exit', reconnect: false, forceExit: true });
        }
    }

    function buildCommandContext() {
        return {
            respond,
            getBot,
            getElytraFly,
            getAutoTunnel,
            getCommander,
            accessControl,
            logger,
            refreshStatus,
            requestShutdown,
            logChatMessage,
            themeManager,
            instanceManager,
            multiBotManager,
            onInstanceStart,
            onInstanceStop,
            initiator: {
                type: 'cli',
                username: 'cli'
            }
        };
    }

    return {
        handleUserInput,
        handleCliExit
    };
}

module.exports = {
    createCliHandler
};
