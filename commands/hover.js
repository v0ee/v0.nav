module.exports = {
    name: 'hover',
    description: 'Force hover mode',
    usage: '.hover',
    handler: async ({ respond = () => {}, getElytraFly }) => {
        const elytraFly = getElytraFly?.();
        if (!elytraFly) {
            respond('Flight module not ready yet.', 'red');
            return;
        }
        await elytraFly.ensureHovering();
        respond('Hover engaged.');
    }
};
