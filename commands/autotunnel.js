module.exports = {
    name: 'autotunnel',
    aliases: ['at', 'tunnel'],
    description: 'Automatically mine a tunnel in a specified direction',
    usage: '.autotunnel <pos|neg|+|-> <limit|inf> | .autotunnel <stop|cancel|pause|resume|status>',
    examples: [
        '.autotunnel pos 100 - Mine 100 blocks in positive direction',
        '.autotunnel neg inf - Mine infinitely in negative direction',
        '.autotunnel - 50 - Mine 50 blocks in negative direction',
        '.autotunnel stop - Stop mining',
        '.autotunnel status - Show current status'
    ],
    handler: async ({ args = [], respond = () => {}, getAutoTunnel, initiator }) => {
        const autoTunnel = getAutoTunnel?.();
        if (!autoTunnel) {
            respond('AutoTunnel module not ready yet.', 'red');
            return;
        }

        const sub = (args[0] || '').toLowerCase();
        const username = initiator?.username;

        switch (sub) {
            case 'stop':
            case 'cancel': {
                const result = autoTunnel.cancel();
                respond(result.message, result.ok ? undefined : 'red');
                return;
            }
            case 'pause': {
                const result = autoTunnel.pause();
                respond(result.message || result.error, result.ok ? undefined : 'red');
                return;
            }
            case 'resume': {
                const result = autoTunnel.resume();
                respond(result.message || result.error, result.ok ? undefined : 'red');
                return;
            }
            case 'status': {
                const status = autoTunnel.getStatus();
                if (status.status === 'inactive') {
                    respond('AutoTunnel is not active.');
                } else if (status.status === 'setup') {
                    respond(`Setup in progress. Pos1: ${status.pos1}, Pos2: ${status.pos2}. Dir: ${status.direction}, Depth: ${status.limit}`);
                } else {
                    const limitStr = status.limit === Infinity ? 'inf' : status.limit;
                    respond(`Status: ${status.status}. Axis: ${status.axis}, Dir: ${status.direction}. Depth: ${status.currentDepth}/${limitStr}. Mined: ${status.mined} blocks.`);
                }
                return;
            }
            case '':
            case 'help': {
                respond('Usage: .autotunnel <pos|neg|+|-> <limit|inf>');
                respond('Subcommands: stop, pause, resume, status');
                return;
            }
        }

        // args[0] = direction (pos/neg/+/-)
        // args[1] = limit (number or 'inf')
        const direction = sub;
        const limitArg = args[1];

        if (!direction) {
            respond('Usage: .autotunnel <pos|neg|+|-> <limit|inf>', 'red');
            return;
        }

        const result = autoTunnel.startSetup(username, direction, limitArg);
        if (result.ok) {
            respond(result.message);
        } else {
            respond(result.error, 'red');
        }
    }
};
