module.exports = {
    name: 'autototem',
    description: 'Keeps a Totem of Undying in the off-hand slot',
    usage: '.autototem <on|off|toggle|status>',
    handler: ({ args = [], respond = () => {}, getAutoTotem }) => {
        const autoTotem = getAutoTotem?.();
        if (!autoTotem) {
            respond('AutoTotem module not ready yet.', 'red');
            return;
        }

        const sub = (args[0] || 'status').toLowerCase();
        switch (sub) {
            case 'on':
            case 'enable':
                autoTotem.setEnabled(true);
                respond('AutoTotem enabled.');
                return;
            case 'off':
            case 'disable':
                autoTotem.setEnabled(false);
                respond('AutoTotem disabled.');
                return;
            case 'toggle': {
                const enabled = autoTotem.toggle();
                respond(`AutoTotem ${enabled ? 'enabled' : 'disabled'}.`);
                return;
            }
            case 'status':
            default: {
                const status = autoTotem.getStatus();
                const mode = status.enabled ? 'enabled' : 'disabled';
                const offhand = status.hasTotemEquipped ? 'Totem equipped' : 'Totem missing';
                const count = status.totemCount;
                respond(`AutoTotem ${mode}. ${offhand}. Inventory: ${count} totem(s).`);
                return;
            }
        }
    }
};
