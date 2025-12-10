const SLOT_ORDER = ['torso', 'head', 'legs', 'feet'];
const SLOT_DEST = {
    head: 'head',
    torso: 'torso',
    legs: 'legs',
    feet: 'feet'
};

const ARMOR_PRIORITY = {
    head: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'golden_helmet', 'chainmail_helmet', 'leather_helmet'],
    torso: ['elytra', 'netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'golden_chestplate', 'chainmail_chestplate', 'leather_chestplate'],
    legs: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'golden_leggings', 'chainmail_leggings', 'leather_leggings'],
    feet: ['netherite_boots', 'diamond_boots', 'iron_boots', 'golden_boots', 'chainmail_boots', 'leather_boots']
};

class AutoArmor {
    constructor(bot, options = {}) {
        this.bot = bot;
        this.forwardSystemLog = options.forwardSystemLog;
        this.enabled = false;
        this.checkInterval = options.checkInterval || 1500;
        this.loop = null;
        this.tickInProgress = false;
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
        this.tickInProgress = false;
    }

    destroy() {
        this.stopLoop();
        this.enabled = false;
    }

    async tick() {
        if (!this.enabled || !this.bot || !this.bot.inventory) return;
        if (this.tickInProgress) return;
        this.tickInProgress = true;
        try {
            for (const slotKey of SLOT_ORDER) {
                const upgrade = this.findUpgrade(slotKey);
                if (upgrade) {
                    await this.bot.equip(upgrade, SLOT_DEST[slotKey]);
                    this.log(`Equipped ${upgrade.displayName || upgrade.name} on ${slotKey}.`, 'green');
                }
            }
        } catch (err) {
            this.log(`AutoArmor error: ${err.message}`, 'red');
        } finally {
            this.tickInProgress = false;
        }
    }

    findUpgrade(slotKey) {
        if (!this.bot || !this.bot.inventory) return null;
        const priority = ARMOR_PRIORITY[slotKey];
        if (!priority || !priority.length) return null;
        const slotIndex = this.bot.getEquipmentDestSlot(SLOT_DEST[slotKey]);
        const current = slotIndex != null ? this.bot.inventory.slots[slotIndex] : null;
        for (const itemName of priority) {
            if (current && current.name === itemName) {
                return null;
            }
        }
        for (const itemName of priority) {
            const candidate = this.bot.inventory.items().find(item => item && item.name === itemName);
            if (candidate) {
                return candidate;
            }
        }
        return null;
    }

    getStatus() {
        const equipped = {};
        for (const slotKey of SLOT_ORDER) {
            equipped[slotKey] = this.getEquippedName(slotKey);
        }
        return {
            enabled: this.enabled,
            equipped
        };
    }

    getEquippedName(slotKey) {
        if (!this.bot || !this.bot.inventory) return 'None';
        const slotIndex = this.bot.getEquipmentDestSlot(SLOT_DEST[slotKey]);
        if (slotIndex == null) return 'None';
        const item = this.bot.inventory.slots[slotIndex];
        return item ? (item.displayName || item.name) : 'None';
    }

    log(message, color) {
        if (typeof this.forwardSystemLog === 'function') {
            this.forwardSystemLog(`[AutoArmor] ${message}`, color);
        } else {
            console.log(`[AutoArmor] ${message}`);
        }
    }
}

module.exports = AutoArmor;
