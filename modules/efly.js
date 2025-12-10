const Vec3 = require('vec3').Vec3;
const fs = require('fs');

class ElytraFly {
    constructor(bot, stateFile, configAdapter = {}) {
        this.bot = bot;
        this.stateFile = stateFile;
        this.getFlightConfig = configAdapter.getFlightConfig || (() => ({}));
        this.saveFlightConfig = configAdapter.saveFlightConfig || (() => Promise.resolve());

        // DEFAULT OPTIONS, DO NOT FUCKING CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING
        this.speed = 0.5; 
        this.maxSpeed = 2.65; 
        this.velocityUpRate = 0.1;
        this.velocityDownRate = 0.01;
        this.verticalSpeed = 0.5;
        this.fallMultiplier = 0;
        this.heightDir = 0;
        this.moveDir = 0;   
        this.active = false;
        this.target = null;
        this.currentWaypointName = null;
        this.hoverAltitude = null;
        this.onTick = this.onTick.bind(this);
        this.recoveryInProgress = false;
        this.pausedState = null;
        this.voidRecoveryActive = false;
        this.voidRecoveryTargetY = 320;
        this.voidSafetyTriggerY = -16;
        this.lastGlideAttempt = 0;
        this.needsInitialGlide = false;
        this.glideAttemptInterval = 350;
        this.applyFlightConfig(this.getFlightConfig());
        
        this.loadState();
    }

    loadState() {
        try {
            if (this.stateFile && fs.existsSync(this.stateFile)) {
                const data = fs.readFileSync(this.stateFile, 'utf8');
                this.state = JSON.parse(data);
                console.log('[ElytraFly] State loaded:', this.state);
                if (this.state.waypointName) this.currentWaypointName = this.state.waypointName;
            } else {
                this.state = {};
            }
        } catch (err) {
            console.error('[ElytraFly] Error loading state:', err);
            this.state = {};
        }
    }

    saveState() {
        if (!this.stateFile) return;
        try {
            const state = {
                active: this.active,
                target: this.target,
                waypointName: this.currentWaypointName
            };
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 4));
        } catch (err) {
            console.error('[ElytraFly] Error saving state:', err);
        }
    }

    async resume() {
        if (this.state && this.state.active && this.state.target) {
            console.log('[ElytraFly] Resuming flight to target:', this.state.target);
            // ensure target is treated as a vec3, cuz it is just {x,y,z} from json
            await this.setTarget(this.state.target, { waypointName: this.state.waypointName });
        }
    }

    async ensureHovering() {
        if (this.active) return;
        try {
            await this.start();
        } catch (err) {
            console.error('[ElytraFly] Failed to enter hover:', err);
        }
    }

    applyFlightConfig(config = {}) {
        if (!config) return;
        if (config.speed !== undefined) this.speed = config.speed;
        if (config.maxSpeed !== undefined) this.maxSpeed = config.maxSpeed;
        if (config.velocityUpRate !== undefined) this.velocityUpRate = config.velocityUpRate;
        if (config.velocityDownRate !== undefined) this.velocityDownRate = config.velocityDownRate;
        if (config.verticalSpeed !== undefined) this.verticalSpeed = config.verticalSpeed;
        if (config.fallMultiplier !== undefined) this.fallMultiplier = config.fallMultiplier;
    }

    saveConfig() {
        const payload = {
            speed: this.speed,
            maxSpeed: this.maxSpeed,
            velocityUpRate: this.velocityUpRate,
            velocityDownRate: this.velocityDownRate,
            verticalSpeed: this.verticalSpeed,
            fallMultiplier: this.fallMultiplier
        };
        return this.saveFlightConfig(payload).catch(err => {
            console.error('[ElytraFly] Error saving config:', err);
        });
    }

    async start() {
        const hasElytra = await this.ensureElytra();
        if (!hasElytra) {
            console.log('[ElytraFly] Could not find or equip elytra.');
            return false;
        }

        this.active = true;
        this.needsInitialGlide = true;
        this.pausedState = null;
        this.voidRecoveryActive = false;
        this.lastGlideAttempt = 0;
        
        await this.bot.look(this.bot.entity.yaw, 0, true);
        
        if (!this.bot.listeners('physicsTick').includes(this.onTick)) {
            this.bot.on('physicsTick', this.onTick);
        }

        if (!this.target && this.bot.entity) {
            this.hoverAltitude = this.bot.entity.position.y;
        } else if (this.target) {
            this.hoverAltitude = null;
        }
        
        return true;
    }

    stop() {
        this.active = false;
        this.needsInitialGlide = false;
        this.bot.removeListener('physicsTick', this.onTick);
        this.target = null;
        this.moveDir = 0;
        this.heightDir = 0;
        this.hoverAltitude = null;
        this.currentWaypointName = null;
        this.lastGlideAttempt = 0;
        this.pausedState = null;
        this.voidRecoveryActive = false;
        this.saveState();
    }

    cleanup() {
        this.bot.removeListener('physicsTick', this.onTick);
        this.active = false;
        this.needsInitialGlide = false;
    }

    stopAndHover(reason = 'manual stop') {
        this.pausedState = null;
        this.target = null;
        this.enterHoverMode(reason);
    }

    pause(reason = 'manual pause') {
        if (this.target) {
            this.pausedState = {
                target: { x: this.target.x, y: this.target.y, z: this.target.z },
                waypointName: this.currentWaypointName
            };
        } else {
            this.pausedState = null;
        }
        this.enterHoverMode(reason);
        return true;
    }

    async resumePausedTarget() {
        if (!this.pausedState || !this.pausedState.target) {
            return false;
        }
        const payload = this.pausedState;
        this.pausedState = null;
        return this.setTarget(payload.target, { waypointName: payload.waypointName });
    }

    enterHoverMode(reason = 'hover') {
        if (!this.bot) return;
        if (!this.bot.listeners('physicsTick').includes(this.onTick)) {
            this.bot.on('physicsTick', this.onTick);
        }
        this.active = true;
        this.target = null;
        this.moveDir = 0;
        this.heightDir = 0;
        this.currentWaypointName = null;
        this.needsInitialGlide = true;
        this.lastGlideAttempt = 0;
        if (this.bot.entity && this.bot.entity.position) {
            this.hoverAltitude = this.bot.entity.position.y;
        }
        console.log(`[ElytraFly] Entering hover mode (${reason}).`);
        this.saveState();
    }

    scheduleHoverRecovery(reason = 'recovery') {
        if (this.recoveryInProgress) return;
        this.recoveryInProgress = true;
        setImmediate(async () => {
            try {
                this.enterHoverMode(reason);
                const equipped = await this.ensureElytra();
                if (equipped) {
                    console.log('[ElytraFly] re-equipped elytra during recovery.');
                } else {
                    console.log('[ElytraFly] no elytra available during recovery.');
                }
            } catch (err) {
                console.error('[ElytraFly] Hover recovery error:', err);
            } finally {
                this.recoveryInProgress = false;
            }
        });
    }

    async ensureElytra() {
        const chestSlot = this.bot.getEquipmentDestSlot('torso');
        const chest = this.bot.inventory.slots[chestSlot];
        if (chest && chest.name === 'elytra') return true;

        const elytra = this.bot.inventory.items().find(item => item.name === 'elytra');
        if (elytra) {
            try {
                console.log('[ElytraFly] Equipping elytra...');
                await this.bot.equip(elytra, 'torso');
                return true;
            } catch (err) {
                console.error('[ElytraFly] Failed to equip elytra:', err);
                return false;
            }
        }
        return false;
    }

    async setTarget(targetVec, options = {}) {
        this.target = targetVec;
        this.active = true;
        this.hoverAltitude = null;
        this.currentWaypointName = options.waypointName || null;
        this.pausedState = null;
        this.saveState();
        return this.start();
    }

    onTick() {
        if (!this.active) return;

        this.handleVoidSafety();

        const chestSlot = this.bot.getEquipmentDestSlot('torso');
        const chest = this.bot.inventory.slots[chestSlot];
        if (!chest || chest.name !== 'elytra') {
            console.log('[ElytraFly] Elytra missing — scheduling hover recovery.');
            this.scheduleHoverRecovery('elytra missing');
            return;
        }

        if (!this.ensureGliding()) {
            return;
        }

        if (this.target) {
            const rawDx = this.target.x - this.bot.entity.position.x;
            const rawDz = this.target.z - this.bot.entity.position.z;
            const dx = rawDx * 1e-6;
            const dz = rawDz * 1e-6;
            const yaw = Math.atan2(-dx, -dz);
            this.bot.entity.yaw = yaw; 
            this.moveDir = 1;
            const pos = this.bot.entity.position;
            const dim = this.bot.game.dimension;   
            let rangeMin, rangeMax;
            if (dim === 'minecraft:the_nether') {
                rangeMin = -5;
                rangeMax = -1;
            } else {
                rangeMin = 320;
                rangeMax = 330;
            }

            if (pos.y < rangeMin) {
                this.heightDir = 1;
            } else if (pos.y > rangeMax) {
                this.heightDir = -1;
            } else {
                this.heightDir = 0;
            }
            
            const distDx = pos.x - this.target.x;
            const distDz = pos.z - this.target.z;
            if (Math.sqrt(distDx*distDx + distDz*distDz) < 5) {
                console.log('[ElytraFly] Target reached. Scheduling hover.');
                this.scheduleHoverRecovery('target reached');
                return;
            }
        }

        this.controlSpeed();
        this.controlHeight();

    }

    handleVoidSafety() {
        if (!this.bot || !this.bot.entity || !this.bot.entity.position) return;
        const pos = this.bot.entity.position;
        const triggerY = this.getVoidSafetyTriggerY();
        if (pos.y <= triggerY) {
            if (!this.voidRecoveryActive) {
                console.log(`[ElytraFly] Void safety triggered at Y=${pos.y}. Initiating emergency hover.`);
                this.enterHoverMode('void safety');
                this.voidRecoveryActive = true;
            }
            this.moveDir = 0;
            this.heightDir = 1;
            this.hoverAltitude = this.voidRecoveryTargetY;
        }

        if (this.voidRecoveryActive && pos.y >= this.voidRecoveryTargetY) {
            this.voidRecoveryActive = false;
            this.hoverAltitude = pos.y;
            console.log('[ElytraFly] Void safety complete. Hovering at safe altitude.');
        }
    }

    getVoidSafetyTriggerY() {
        const dim = this.bot && this.bot.game ? this.bot.game.dimension : null;
        if (dim === 'minecraft:the_nether') {
            return -2;
        }
        return this.voidSafetyTriggerY;
    }

    controlHeight() {
        const vel = this.bot.entity.velocity;
        const pos = this.bot.entity.position;

        if (this.voidRecoveryActive) {
            const climb = Math.max(this.verticalSpeed, 1);
            this.bot.entity.velocity.set(vel.x, climb, vel.z);
            return;
        }

        if (!this.target) {
            if (pos) {
                if (this.hoverAltitude === null) {
                    this.hoverAltitude = pos.y;
                }
                const delta = this.hoverAltitude - pos.y;
                const adjust = Math.max(Math.min(delta * 0.1, 0.05), -0.05);
                this.bot.entity.velocity.set(vel.x, vel.y + adjust, vel.z);
            }
            return;
        }
        
        if (this.heightDir === 1) {
            this.bot.entity.velocity.set(vel.x, vel.y + this.velocityUpRate, vel.z);
        } else if (this.heightDir === -1) {
            this.bot.entity.velocity.set(vel.x, vel.y - this.velocityUpRate, vel.z);
        } else {
            this.bot.entity.velocity.set(vel.x, vel.y + 0.07545, vel.z);
        }
    }

    controlSpeed() {
        const yaw = this.bot.entity.yaw;
        const forward = new Vec3(Math.sin(yaw) * this.speed, 0, Math.cos(yaw) * this.speed);
        const vel = this.bot.entity.velocity;

        let nextX = vel.x;
        let nextZ = vel.z;

        if (this.moveDir === -1) {
            nextX += forward.x;
            nextZ += forward.z;
        } else if (this.moveDir === 1) {
            nextX -= forward.x;
            nextZ -= forward.z;
        } else {
            nextX = 0;
            nextZ = 0;
        }

        const hSpeed = Math.sqrt(nextX * nextX + nextZ * nextZ);
        if (hSpeed > this.maxSpeed) {
            const factor = this.maxSpeed / hSpeed;
            nextX *= factor;
            nextZ *= factor;
        }

        this.bot.entity.velocity.set(nextX, vel.y, nextZ);
    }

    doInstantFly() {
        this.bot.setControlState('jump', true);
        setTimeout(() => {
            this.bot._client.write('entity_action', {
                entityId: this.bot.entity.id,
                actionId: 8,
                jumpBoost: 0
            });
            this.bot.setControlState('jump', false);
        }, 55);
    }

    ensureGliding() {
        if (!this.bot || !this.bot.entity) return false;
        const isGliding = !!this.bot.entity.elytraFlying;
        if (isGliding) {
            this.needsInitialGlide = false;
            return true;
        }
        const now = Date.now();
        if (!this.needsInitialGlide) {
            this.needsInitialGlide = true;
            this.lastGlideAttempt = now;
            this.doInstantFly();
            return false;
        }
        if (now - this.lastGlideAttempt >= this.glideAttemptInterval) {
            this.lastGlideAttempt = now;
            this.doInstantFly();
        }
        return false;
    }
}

module.exports = ElytraFly;
