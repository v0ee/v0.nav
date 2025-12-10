const FOOD_PRIORITY = [
    { name: 'enchanted_golden_apple', hunger: 4, saturation: 9.6, priority: 100 },
    { name: 'golden_apple', hunger: 4, saturation: 9.6, priority: 90 },
    { name: 'golden_carrot', hunger: 6, saturation: 14.4, priority: 80 },
    { name: 'cooked_porkchop', hunger: 8, saturation: 12.8, priority: 70 },
    { name: 'cooked_beef', hunger: 8, saturation: 12.8, priority: 70 },
    { name: 'cooked_mutton', hunger: 6, saturation: 9.6, priority: 65 },
    { name: 'cooked_salmon', hunger: 6, saturation: 9.6, priority: 60 },
    { name: 'baked_potato', hunger: 5, saturation: 6, priority: 55 },
    { name: 'cooked_chicken', hunger: 6, saturation: 7.2, priority: 55 },
    { name: 'cooked_rabbit', hunger: 5, saturation: 6, priority: 55 },
    { name: 'cooked_cod', hunger: 5, saturation: 6, priority: 50 },
    { name: 'bread', hunger: 5, saturation: 6, priority: 45 },
    { name: 'carrot', hunger: 3, saturation: 3.6, priority: 40 },
    { name: 'apple', hunger: 4, saturation: 2.4, priority: 35 },
    { name: 'melon_slice', hunger: 2, saturation: 1.2, priority: 30 },
    { name: 'sweet_berries', hunger: 2, saturation: 0.4, priority: 25 },
    { name: 'dried_kelp', hunger: 1, saturation: 0.6, priority: 20 },
    { name: 'potato', hunger: 1, saturation: 0.6, priority: 15 },
    { name: 'beetroot', hunger: 1, saturation: 1.2, priority: 15 },
    { name: 'cookie', hunger: 2, saturation: 0.4, priority: 10 },
    { name: 'pumpkin_pie', hunger: 8, saturation: 4.8, priority: 60 },
    { name: 'rabbit_stew', hunger: 10, saturation: 12, priority: 75 },
    { name: 'mushroom_stew', hunger: 6, saturation: 7.2, priority: 50 },
    { name: 'beetroot_soup', hunger: 6, saturation: 7.2, priority: 50 },
    { name: 'suspicious_stew', hunger: 6, saturation: 7.2, priority: 40 }
];

const FOOD_MAP = new Map(FOOD_PRIORITY.map(f => [f.name, f]));

class AutoEat {
    constructor(bot, options = {}) {
        this.bot = bot;
        this.forwardSystemLog = options.forwardSystemLog;
        this.getAutoTunnel = options.getAutoTunnel || (() => null);

        this.enabled = false;
        this.eating = false;
        this.checkInterval = options.checkInterval || 500;
        this.healthThreshold = options.healthThreshold || 10;
        this.hungerThreshold = options.hungerThreshold || 10;
        this.loop = null;
        this.tunnelWasPaused = false;
    }

    setEnabled(flag) {
        const next = !!flag;
        if (next === this.enabled) return this.enabled;
        this.enabled = next;
        if (this.enabled) {
            this.startLoop();
        } else {
            this.stopLoop();
        }
        return this.enabled;
    }

    toggle() {
        return this.setEnabled(!this.enabled);
    }

    startLoop() {
        if (this.loop) return;
        this.loop = setInterval(() => this.tick(), this.checkInterval);
        this.tick();
    }

    stopLoop() {
        if (this.loop) {
            clearInterval(this.loop);
            this.loop = null;
        }
        this.eating = false;
    }

    destroy() {
        this.stopLoop();
        this.enabled = false;
    }

    shouldEat() {
        if (!this.bot || !this.bot.health || !this.bot.food) return false;
        const health = this.bot.health;
        const hunger = this.bot.food;
        return health < this.healthThreshold || hunger < this.hungerThreshold;
    }

    findBestFood() {
        if (!this.bot || !this.bot.inventory) return null;
        const items = this.bot.inventory.items();
        let best = null;
        let bestPriority = -1;
        for (const item of items) {
            const foodInfo = FOOD_MAP.get(item.name);
            if (foodInfo && foodInfo.priority > bestPriority) {
                best = item;
                bestPriority = foodInfo.priority;
            }
        }
        return best;
    }

    async tick() {
        if (!this.enabled || !this.bot || this.eating) return;
        if (!this.shouldEat()) return;

        const food = this.findBestFood();
        if (!food) return;

        this.eating = true;

        const autoTunnel = this.getAutoTunnel();
        if (autoTunnel && autoTunnel.active && !autoTunnel.miningSession?.paused) {
            autoTunnel.pause();
            this.tunnelWasPaused = true;
            this.log('Pausing AutoTunnel to eat...', 'yellow');
        }

        try {
            await this.bot.equip(food, 'hand');
            await this.bot.consume();
            this.log(`Ate ${food.displayName || food.name}.`, 'green');
        } catch (err) {
            this.log(`Failed to eat: ${err.message}`, 'red');
        } finally {
            this.eating = false;
            if (this.tunnelWasPaused) {
                const autoTunnel2 = this.getAutoTunnel();
                if (autoTunnel2) {
                    autoTunnel2.resume();
                    this.log('Resumed AutoTunnel after eating.', 'cyan');
                }
                this.tunnelWasPaused = false;
            }
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            eating: this.eating,
            health: this.bot?.health || 0,
            hunger: this.bot?.food || 0,
            bestFood: this.findBestFood()?.name || 'None'
        };
    }

    log(message, color) {
        if (typeof this.forwardSystemLog === 'function') {
            this.forwardSystemLog(`[AutoEat] ${message}`, color);
        } else {
            console.log(`[AutoEat] ${message}`);
        }
    }
}

module.exports = AutoEat;
