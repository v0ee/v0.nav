const SLOT_LABELS = {
    head: 'Helmet',
    torso: 'Chest',
    legs: 'Leggings',
    feet: 'Boots'
};

module.exports = {
    name: 'autoarmor',
    description: 'Automatically equips the best armor pieces (elytra preferred)',
    usage: '.autoarmor <on|off|toggle|status>',
    handler: ({ args = [], respond = () => {}, getAutoArmor }) => {
        const autoArmor = getAutoArmor?.();
        if (!autoArmor) {
            respond('AutoArmor module not ready yet.', 'red');
            return;
        }

        const sub = (args[0] || 'status').toLowerCase();
        switch (sub) {
            case 'on':
            case 'enable':
                autoArmor.setEnabled(true);
                respond('AutoArmor enabled.');
                return;
            case 'off':
            case 'disable':
                autoArmor.setEnabled(false);
                respond('AutoArmor disabled.');
                return;
            case 'toggle': {
                const enabled = autoArmor.toggle();
                respond(`AutoArmor ${enabled ? 'enabled' : 'disabled'}.`);
                return;
            }
            case 'status':
            default: {
                const status = autoArmor.getStatus();
                const parts = Object.entries(status.equipped || {}).map(([slot, name]) => {
                    const label = SLOT_LABELS[slot] || slot;
                    return `${label}: ${name}`;
                });
                respond(`AutoArmor ${status.enabled ? 'enabled' : 'disabled'}. ${parts.join(', ')}`);
                return;
            }
        }
    }
};
