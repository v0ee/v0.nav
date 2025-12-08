module.exports = {
    name: 'whitelist',
    description: 'Manage whitelist entries',
    usage: '.whitelist <add|remove|list> ...',
    aliases: ['wl'],
    handler: async ({ args = [], respond = () => {}, accessControl, initiator }) => {
        if (!accessControl) {
            respond('Access control not initialized.', 'red');
            return;
        }
        const sub = (args[0] || '').toLowerCase();
        switch (sub) {
            case 'add':
                await handleAdd(args.slice(1), { respond, accessControl, initiator });
                break;
            case 'remove':
            case 'rm':
            case 'del':
            case 'delete':
                await handleRemove(args.slice(1), { respond, accessControl });
                break;
            case 'list':
                handleList({ respond, accessControl });
                break;
            default:
                respond('Usage: .whitelist <add|remove|list>', 'red');
        }
    }
};

async function handleAdd(args, { respond, accessControl, initiator }) {
    if (!args.length) {
        respond('Usage: .whitelist add <username|uuid> [role]', 'red');
        return;
    }
    const identifier = args[0];
    const requestedRole = (args[1] || 'whitelist').toLowerCase();
    
    let role = 'whitelist';
    if (requestedRole === 'admin') {
        const isCli = initiator?.type === 'cli';
        const isOwner = accessControl.isOwner({ uuid: initiator?.uuid, username: initiator?.username });
        if (isCli || isOwner) {
            role = 'admin';
        } else {
            respond('Only the owner can add admins.', 'red');
            return;
        }
    }
    
    const addedBy = initiator?.username || initiator?.type || 'cli';
    try {
        const entry = await accessControl.addEntry({ identifier, role, addedBy });
        respond(`Added ${entry.lastSeenAs || entry.uuid} as ${entry.role}.`);
    } catch (err) {
        respond(err.message || 'Failed to add whitelist entry.', 'red');
    }
}

async function handleRemove(args, { respond, accessControl }) {
    if (!args.length) {
        respond('Usage: .whitelist remove <username|uuid>', 'red');
        return;
    }
    const identifier = args[0];
    try {
        const removed = await accessControl.removeEntry(identifier);
        if (removed) {
            respond(`Removed ${removed.lastSeenAs || removed.uuid} from whitelist.`);
        } else {
            respond(`Entry "${identifier}" not found.`, 'red');
        }
    } catch (err) {
        respond(err.message || 'Failed to remove whitelist entry.', 'red');
    }
}

function handleList({ respond, accessControl }) {
    const entries = accessControl.listEntries();
    if (!entries.length) {
        respond('Whitelist is empty.');
        return;
    }
    const lines = entries.map(entry => {
        const label = entry.lastSeenAs ? `${entry.lastSeenAs} (${entry.uuid})` : entry.uuid;
        return `${label} - ${entry.role} (added by ${entry.addedBy})`;
    });
    respond(lines.join(' | '));
}
