module.exports = {
    name: 'instance',
    aliases: ['inst', 'i'],
    description: 'Manage bot instances (F2 for GUI)',
    usage: '.instance [list|start|stop|active|add|info]',

    async execute(ctx) {
        const { respond, args } = ctx;
        const instanceManager = ctx.instanceManager;
        const multiBotManager = ctx.multiBotManager;

        if (!instanceManager) {
            respond('Instance manager not available.', 'red');
            return;
        }

        const subcommand = (args[0] || 'info').toLowerCase();

        switch (subcommand) {
            case 'list':
            case 'ls':
                listInstances(ctx, instanceManager, multiBotManager);
                break;

            case 'start':
                await startInstance(ctx, instanceManager, multiBotManager, args.slice(1).join(' '));
                break;

            case 'stop':
                stopInstance(ctx, multiBotManager, args.slice(1).join(' '));
                break;

            case 'active':
            case 'focus':
                setActive(ctx, instanceManager, multiBotManager, args.slice(1).join(' '));
                break;

            case 'add':
            case 'new':
                await addInstance(ctx, instanceManager, args.slice(1));
                break;

            case 'remove':
            case 'rm':
            case 'delete':
                await removeInstance(ctx, instanceManager, multiBotManager, args.slice(1).join(' '));
                break;

            case 'info':
            default:
                showInfo(ctx, instanceManager, multiBotManager);
                break;
        }
    }
};

function listInstances(ctx, instanceManager, multiBotManager) {
    const { respond } = ctx;
    const instances = instanceManager.getInstances();
    const activeId = multiBotManager?.getActiveInstanceId();

    respond('=== Bot Instances ===', 'cyan');
    
    if (!instances.length) {
        respond('No instances configured.', 'yellow');
        return;
    }

    instances.forEach((inst, idx) => {
        const isRunning = multiBotManager?.isRunning(inst.id);
        const isActive = inst.id === activeId;
        const statusIcon = isRunning ? '●' : '○';
        const activeMarker = isActive ? ' [ACTIVE]' : '';
        const host = inst.minecraft?.host || 'N/A';
        const color = isActive ? 'green' : isRunning ? 'cyan' : 'white';
        respond(`${statusIcon} ${idx + 1}. ${inst.name} (${host})${activeMarker}`, color);
    });

    respond('', 'white');
    respond('● = Running, ○ = Stopped', 'cyan');
    respond('Use .instance start/stop <name> to control instances', 'cyan');
}

async function startInstance(ctx, instanceManager, multiBotManager, name) {
    const { respond, onInstanceStart } = ctx;

    if (!name) {
        respond('Usage: .instance start <name>', 'yellow');
        return;
    }

    const instances = instanceManager.getInstances();
    const instance = instances.find(i => 
        i.name.toLowerCase() === name.toLowerCase() ||
        i.id === name
    );

    if (!instance) {
        respond(`Instance "${name}" not found.`, 'red');
        respond('Use .instance list to see available instances.', 'yellow');
        return;
    }

    if (multiBotManager?.isRunning(instance.id)) {
        respond(`Instance "${instance.name}" is already running.`, 'yellow');
        return;
    }

    if (typeof onInstanceStart === 'function') {
        onInstanceStart(instance);
    } else {
        respond('Cannot start instance - handler not available.', 'red');
    }
}

function stopInstance(ctx, multiBotManager, name) {
    const { respond, onInstanceStop, instanceManager } = ctx;

    if (!name) {
        respond('Usage: .instance stop <name>', 'yellow');
        return;
    }

    const instances = instanceManager.getInstances();
    const instance = instances.find(i => 
        i.name.toLowerCase() === name.toLowerCase() ||
        i.id === name
    );

    if (!instance) {
        respond(`Instance "${name}" not found.`, 'red');
        return;
    }

    if (!multiBotManager?.isRunning(instance.id)) {
        respond(`Instance "${instance.name}" is not running.`, 'yellow');
        return;
    }

    if (typeof onInstanceStop === 'function') {
        onInstanceStop(instance.id);
        respond(`Stopping instance: ${instance.name}...`, 'yellow');
    } else {
        respond('Cannot stop instance - handler not available.', 'red');
    }
}

function setActive(ctx, instanceManager, multiBotManager, name) {
    const { respond } = ctx;

    if (!name) {
        respond('Usage: .instance active <name>', 'yellow');
        return;
    }

    const instances = instanceManager.getInstances();
    const instance = instances.find(i => 
        i.name.toLowerCase() === name.toLowerCase() ||
        i.id === name
    );

    if (!instance) {
        respond(`Instance "${name}" not found.`, 'red');
        return;
    }

    if (!multiBotManager?.isRunning(instance.id)) {
        respond(`Instance "${instance.name}" is not running. Start it first.`, 'yellow');
        return;
    }

    if (multiBotManager.setActiveInstance(instance.id)) {
        respond(`Active instance set to: ${instance.name}`, 'green');
    } else {
        respond('Failed to set active instance.', 'red');
    }
}

async function addInstance(ctx, instanceManager, args) {
    const { respond } = ctx;

    if (args.length < 1) {
        respond('Usage: .instance add <name> [host] [username]', 'yellow');
        respond('Example: .instance add MyServer 2b2t.org BotName', 'cyan');
        return;
    }

    const name = args[0];
    const host = args[1] || '0b0t.org';
    const username = args[2] || 'v0nav';

    const existing = instanceManager.getInstances().find(i => 
        i.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
        respond(`Instance "${name}" already exists.`, 'red');
        return;
    }

    const instance = await instanceManager.addInstance(name, {
        host,
        username,
        auth: 'microsoft',
        version: '1.20.4'
    });

    respond(`Created instance: ${instance.name}`, 'green');
    respond(`  Host: ${instance.minecraft.host}`, 'cyan');
    respond(`  Username: ${instance.minecraft.username}`, 'cyan');
    respond('Use .instance start to start it.', 'yellow');
}

async function removeInstance(ctx, instanceManager, multiBotManager, name) {
    const { respond } = ctx;

    if (!name) {
        respond('Usage: .instance remove <name>', 'yellow');
        return;
    }

    if (instanceManager.getInstanceCount() <= 1) {
        respond('Cannot remove the last instance.', 'red');
        return;
    }

    const instances = instanceManager.getInstances();
    const instance = instances.find(i => 
        i.name.toLowerCase() === name.toLowerCase() ||
        i.id === name
    );

    if (!instance) {
        respond(`Instance "${name}" not found.`, 'red');
        return;
    }

    if (multiBotManager?.isRunning(instance.id)) {
        respond(`Cannot remove running instance. Stop it first with .instance stop ${instance.name}`, 'red');
        return;
    }

    await instanceManager.removeInstance(instance.id);
    respond(`Removed instance: ${instance.name}`, 'yellow');
}

function showInfo(ctx, instanceManager, multiBotManager) {
    const { respond } = ctx;
    const runningCount = multiBotManager?.getRunningCount() || 0;
    const totalCount = instanceManager.getInstanceCount();
    const activeEntry = multiBotManager?.getActiveEntry();

    respond('=== Instance Info ===', 'cyan');
    respond(`Running: ${runningCount}/${totalCount} instances`, runningCount > 0 ? 'green' : 'yellow');
    
    if (activeEntry) {
        respond(`Active: ${activeEntry.instance.name}`, 'green');
        respond(`  Host: ${activeEntry.instance.minecraft?.host || 'N/A'}`, 'white');
        const bot = activeEntry.botManager?.getBot();
        respond(`  Connected: ${bot?.entity ? 'Yes' : 'No'}`, 'white');
    } else {
        respond('No active instance.', 'yellow');
    }

    respond('', 'white');
    respond('Commands:', 'cyan');
    respond('  .instance list           - List all instances', 'white');
    respond('  .instance start <name>   - Start an instance', 'white');
    respond('  .instance stop <name>    - Stop an instance', 'white');
    respond('  .instance active <name>  - Set active instance', 'white');
    respond('  .instance add <name>     - Create new instance', 'white');
    respond('  .instance remove <name>  - Remove instance', 'white');
    respond('', 'white');
    respond('Or press F2 to open Instance Manager GUI', 'cyan');
}
