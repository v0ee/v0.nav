module.exports = {
    name: 'whitelist',
    description: 'Manage whitelist entries',
    usage: '.whitelist <add|list> ...',
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
            case 'list':
                handleList({ respond, accessControl });
                break;
            default:
                respond('Usage: .whitelist <add|list>', 'red');
        }
    }
};

async function handleAdd(args, { respond, accessControl, initiator }) {
    if (!args.length) {
        respond('Usage: .whitelist add <username|uuid> [role]', 'red');
        return;
    }
    const identifier = args[0];
    const role = (args[1] || 'whitelist').toLowerCase() === 'admin' ? 'admin' : 'whitelist';
    const addedBy = initiator?.username || initiator?.type || 'cli';
    try {
        const entry = await accessControl.addEntry({ identifier, role, addedBy });
        respond(`Added ${entry.lastSeenAs || entry.uuid} as ${entry.role}.`);
    } catch (err) {
        respond(err.message || 'Failed to add whitelist entry.', 'red');
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
