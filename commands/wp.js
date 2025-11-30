module.exports = {
    name: 'wp',
    description: 'Waypoint utilities',
    usage: '.wp <list|goto|add|del>',
    handler: async ({ args = [], respond = () => {}, getCommander, getElytraFly, getBot }) => {
        const commander = getCommander?.();
        const elytraFly = getElytraFly?.();
        if (!commander || !elytraFly) {
            respond('Commander/flight module not ready yet.', 'red');
            return;
        }
        const bot = getBot?.();
        const sub = (args[0] || '').toLowerCase();
        switch (sub) {
            case 'list':
                return respondWithList(commander, respond);
            case 'add':
                return handleAddWaypoint(args.slice(1), commander, respond);
            case 'del':
            case 'delete':
                return handleDeleteWaypoint(args.slice(1), commander, respond);
            case 'goto':
                return handleGotoWaypoint(args.slice(1), { commander, elytraFly, bot, respond });
            default:
                respond('Usage: .wp <list|add|del|goto>', 'red');
        }
    }
};

function respondWithList(commander, respond) {
    const names = Object.keys(commander.waypoints || {});
    respond(names.length ? `Waypoints: ${names.join(', ')}` : 'No waypoints saved.');
}

function handleAddWaypoint(args, commander, respond) {
    if (args.length < 4) {
        respond('Usage: .wp add <name> <x> <z> <dimension>', 'red');
        return;
    }
    const [name, xRaw, zRaw, dimRaw] = args;
    if (!name) {
        respond('Waypoint name required.', 'red');
        return;
    }
    const x = parseInt(xRaw, 10);
    const z = parseInt(zRaw, 10);
    if (Number.isNaN(x) || Number.isNaN(z)) {
        respond('Invalid coordinates. Use integers.', 'red');
        return;
    }
    const dimension = parseDimension(dimRaw);
    if (!dimension) {
        respond('Invalid dimension. Use o|overworld, n|nether, e|end.', 'red');
        return;
    }
    commander.waypoints[name] = { x, z, dimension };
    commander.saveWaypoints();
    respond(`Waypoint "${name}" added at X:${x}, Z:${z} in ${dimension.replace('minecraft:', '')}.`);
}

function handleDeleteWaypoint(args, commander, respond) {
    const name = args[0];
    if (!name) {
        respond('Usage: .wp del <name>', 'red');
        return;
    }
    if (!commander.waypoints?.[name]) {
        respond(`Waypoint "${name}" not found.`, 'red');
        return;
    }
    delete commander.waypoints[name];
    commander.saveWaypoints();
    respond(`Waypoint "${name}" deleted.`);
}

async function handleGotoWaypoint(args, { commander, elytraFly, bot, respond }) {
    const name = args[0];
    if (!name) {
        respond('Usage: .wp goto <name>', 'red');
        return;
    }
    const wp = commander.waypoints?.[name];
    if (!wp) {
        respond(`Waypoint "${name}" not found.`, 'red');
        return;
    }
    if (!bot || !bot.game || !bot.game.dimension) {
        respond('Bot dimension unknown (not spawned yet).', 'red');
        return;
    }
    if (!bot.entity) {
        respond('Bot entity not ready yet.', 'red');
        return;
    }
    const currentDim = bot.game.dimension.replace('minecraft:', '');
    const wpDim = wp.dimension ? wp.dimension.replace('minecraft:', '') : currentDim;
    if (wpDim !== currentDim) {
        respond(`Waypoint is in ${wpDim} but bot is in ${currentDim}.`, 'red');
        return;
    }
    const target = { x: wp.x, y: bot.entity.position.y, z: wp.z };
    const ok = await elytraFly.setTarget(target, { waypointName: name });
    respond(ok ? `Flying to ${name}...` : 'Failed to start flight.');
}

function parseDimension(raw) {
    if (!raw) return null;
    const value = raw.toLowerCase();
    switch (value) {
        case 'o':
        case 'overworld':
        case 'minecraft:overworld':
            return 'minecraft:overworld';
        case 'n':
        case 'nether':
        case 'minecraft:the_nether':
            return 'minecraft:the_nether';
        case 'e':
        case 'end':
        case 'minecraft:the_end':
            return 'minecraft:the_end';
        default:
            return null;
    }
}
