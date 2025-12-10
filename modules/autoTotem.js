class AutoTotem {
    constructor(bot, options = {}) {
        this.bot = bot;
        this.forwardSystemLog = options.forwardSystemLog;
        this.enabled = false;
        this.checkInterval = options.checkInterval || 750;
        this.loop = null;
        this.equipInProgress = false;
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
        this.equipInProgress = false;
    }

    destroy() {
        this.stopLoop();
        this.enabled = false;
    }

    hasTotemEquipped() {
        if (!this.bot || !this.bot.inventory) return false;
        const offhandSlot = this.bot.getEquipmentDestSlot('off-hand');
        if (offhandSlot == null) return false;
        const offhand = this.bot.inventory.slots[offhandSlot];
        return !!(offhand && offhand.name === 'totem_of_undying');
    }

    findTotemInInventory() {
        if (!this.bot || !this.bot.inventory) return null;
        return this.bot.inventory.items().find(item => item && item.name === 'totem_of_undying') || null;
    }

    countTotems() {
        if (!this.bot || !this.bot.inventory) return 0;
        return this.bot.inventory.items().reduce((count, item) => {
            if (item && item.name === 'totem_of_undying') {
                return count + item.count;
            }
            return count;
        }, 0);
    }

    async tick() {
        if (!this.enabled || !this.bot || !this.bot.inventory) return;
        if (this.equipInProgress) return;
        if (this.hasTotemEquipped()) return;
        const totem = this.findTotemInInventory();
        if (!totem) return;
        this.equipInProgress = true;
        try {
            await this.bot.equip(totem, 'off-hand');
            this.log('Totem equipped in off-hand.', 'green');
        } catch (err) {
            this.log(`Failed to equip totem: ${err.message}`, 'red');
        } finally {
            this.equipInProgress = false;
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            hasTotemEquipped: this.hasTotemEquipped(),
            totemCount: this.countTotems()
        };
    }

    log(message, color) {
        if (typeof this.forwardSystemLog === 'function') {
            this.forwardSystemLog(`[AutoTotem] ${message}`, color);
        } else {
            console.log(`[AutoTotem] ${message}`);
        }
    }
}

module.exports = AutoTotem;
