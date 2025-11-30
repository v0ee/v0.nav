module.exports = {
    name: 'say',
    description: 'Send chat message as the bot',
    usage: '.say <message>',
    handler: ({ args = [], respond = () => {}, getBot, logChatMessage }) => {
        const message = args.join(' ');
        if (!message) {
            respond('Usage: .say <message>', 'red');
            return;
        }
        const bot = getBot?.();
        if (!bot) {
            respond('Bot not connected.', 'red');
            return;
        }
        bot.chat(message);
        if (typeof logChatMessage === 'function') {
            logChatMessage(`<You> ${message}`, 'yellow');
        } else {
            respond(`<You> ${message}`, 'yellow');
        }
    }
};
