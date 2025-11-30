const { handleNumericConfig } = require('./helpers');

module.exports = {
    name: 'fly',
    description: 'Manage ElytraFly module',
    usage: '.fly <start|stop|speed|vspeed|fall|status> [value]',
    handler: async ({ args = [], respond = () => {}, getElytraFly }) => {
        const elytraFly = getElytraFly?.();
        if (!elytraFly) {
            respond('Flight module not ready yet.', 'red');
            return;
        }
        const sub = (args[0] || '').toLowerCase();
        switch (sub) {
            case 'start': {
                const ok = await elytraFly.start();
                respond(ok ? 'ElytraFly started.' : 'Failed to start (no elytra).');
                break;
            }
            case 'stop':
                elytraFly.stop();
                respond('ElytraFly stopped.');
                break;
            case 'speed':
                handleNumericConfig(respond, args[1], 'speed', value => {
                    elytraFly.speed = value;
                    elytraFly.saveConfig();
                }, elytraFly.speed);
                break;
            case 'vspeed':
                handleNumericConfig(respond, args[1], 'vertical speed', value => {
                    elytraFly.verticalSpeed = value;
                    elytraFly.saveConfig();
                }, elytraFly.verticalSpeed);
                break;
            case 'fall':
                handleNumericConfig(respond, args[1], 'fall multiplier', value => {
                    elytraFly.fallMultiplier = value;
                    elytraFly.saveConfig();
                }, elytraFly.fallMultiplier);
                break;
            case 'status': {
                const status = `Active: ${elytraFly.active}, Speed: ${elytraFly.speed}, VSpeed: ${elytraFly.verticalSpeed}, Fall: ${elytraFly.fallMultiplier}`;
                respond(status);
                break;
            }
            default:
                respond('Usage: .fly <start|stop|speed|vspeed|fall|status>', 'red');
        }
    }
};
