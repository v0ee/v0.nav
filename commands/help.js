module.exports = {
    name: 'help',
    aliases: ['?'],
    description: 'Show help for commands',
    usage: '.help [command]',
    handler: ({ args = [], respond = () => {}, router, initiator }) => {
        if (!router) return;
        if (!args.length) {
            const isCli = initiator?.type === 'cli';
            const visible = router.listCommands().filter(cmd => !cmd.hidden && (isCli || !cmd.cliOnly));
            const names = visible.map(cmd => cmd.name).sort().join(', ');
            respond(`Commands: ${names}`);
            return;
        }
        const target = router.resolve(args[0]);
        if (!target) {
            respond(`No command named "${args[0]}"`, 'red');
            return;
        }
        respond(`${target.name}: ${target.description || 'No description.'}`);
        if (target.usage) {
            respond(`Usage: ${target.usage}`);
        }
    }
};
