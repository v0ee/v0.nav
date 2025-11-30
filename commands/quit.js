module.exports = {
    name: 'quit',
    description: 'Shutdown the bot',
    usage: '.quit',
    handler: ({ respond = () => {}, requestShutdown }) => {
        requestShutdown?.({ reason: 'Command quit', reconnect: false });
        respond('Shutting down bot...');
    }
};
