module.exports = {
    name: 'tpa',
    aliases: ['come'],
    description: 'Send /tpa requests',
    usage: '.tpa <player>',
    handler: ({ args = [], respond = () => {}, getBot, initiator }) => {
        let target = (args[0] || '').trim();
        if (!target && initiator?.type === 'whisper' && initiator.username) {
            target = initiator.username.trim();
        }
        if (!target) {
            respond('Usage: .tpa <player>', 'red');
            return;
        }
        if (!/^[A-Za-z0-9_]{3,16}$/.test(target)) {
            respond('Invalid Minecraft username.', 'red');
            return;
        }
        const bot = getBot?.();
        if (!bot) {
            respond('Bot not connected.', 'red');
            return;
        }
        bot.chat(`/tpa ${target}`);
        if (initiator?.username && target.toLowerCase() === initiator.username.toLowerCase()) {
            respond(`Sent /tpa ${target}. Coming to you.`);
        } else {
            respond(`Sent /tpa ${target}.`);
        }
    }
};
