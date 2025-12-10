module.exports = {
    name: 'autoeat',
    description: 'Automatically eat food when health or hunger is low',
    usage: '.autoeat <on|off|toggle|status>',
    handler: ({ args = [], respond = () => {}, getAutoEat }) => {
        const autoEat = getAutoEat?.();
        if (!autoEat) {
            respond('AutoEat module not ready yet.', 'red');
            return;
        }

        const sub = (args[0] || 'status').toLowerCase();
        switch (sub) {
            case 'on':
            case 'enable':
                autoEat.setEnabled(true);
                respond('AutoEat enabled.');
                return;
            case 'off':
            case 'disable':
                autoEat.setEnabled(false);
                respond('AutoEat disabled.');
                return;
            case 'toggle': {
                const enabled = autoEat.toggle();
                respond(`AutoEat ${enabled ? 'enabled' : 'disabled'}.`);
                return;
            }
            case 'status':
            default: {
                const status = autoEat.getStatus();
                const mode = status.enabled ? 'enabled' : 'disabled';
                const eating = status.eating ? ' (eating)' : '';
                respond(`AutoEat ${mode}${eating}. HP: ${status.health}, Hunger: ${status.hunger}. Best food: ${status.bestFood}`);
                return;
            }
        }
    }
};
