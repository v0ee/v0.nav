const Vec3 = require('vec3').Vec3;

class AutoTunnel {
    constructor(bot, options = {}) {
        this.bot = bot;
        this.logger = options.logger;
        this.forwardSystemLog = options.forwardSystemLog;
        
        this.active = false;
        this.pendingSetup = null;
        this.miningSession = null;
        this.reachDistance = 4.5;
        
        this.onPlayerAction = this.onPlayerAction.bind(this);
    }

    log(message, color) {
        console.log(`[AutoTunnel] ${message}`);
        if (this.forwardSystemLog) {
            this.forwardSystemLog(`[AutoTunnel] ${message}`, color);
        }
    }

    startSetup(username, direction, limit) {
        if (this.active) {
            return { ok: false, error: 'AutoTunnel is already active. Use .autotunnel stop first.' };
        }
        if (this.pendingSetup) {
            return { ok: false, error: 'Setup already in progress. Punch blocks to set positions or use .autotunnel cancel.' };
        }

        const normalizedDir = this.normalizeDirection(direction);
        if (!normalizedDir) {
            return { ok: false, error: 'Invalid direction. Use pos/neg or +/-' };
        }

        const parsedLimit = this.parseLimit(limit);
        if (parsedLimit === null) {
            return { ok: false, error: 'Invalid limit. Use a number or "inf" for infinite.' };
        }

        this.pendingSetup = {
            username,
            direction: normalizedDir,
            limit: parsedLimit,
            pos1: null,
            pos2: null
        };

        this._lastDetectedPos = null;
        this.bot._client.on('block_break_animation', this.onPlayerAction);

        return { 
            ok: true, 
            message: `Punch the first block to set Position 1. Direction: ${normalizedDir}, Limit: ${parsedLimit === Infinity ? 'infinite' : parsedLimit} blocks` 
        };
    }

    normalizeDirection(dir) {
        if (!dir) return null;
        const d = dir.toLowerCase().trim();
        if (d === 'pos' || d === '+' || d === 'positive') return 'positive';
        if (d === 'neg' || d === '-' || d === 'negative') return 'negative';
        return null;
    }

    parseLimit(limit) {
        if (limit === undefined || limit === null) return 100;
        if (typeof limit === 'string') {
            const l = limit.toLowerCase().trim();
            if (l === 'inf' || l === 'infinite' || l === 'infinity') return Infinity;
            const num = parseInt(l, 10);
            if (isNaN(num) || num <= 0) return null;
            return num;
        }
        if (typeof limit === 'number') {
            if (limit <= 0) return null;
            return limit;
        }
        return null;
    }

    onPlayerAction(packet) {
        if (!this.pendingSetup) return;
        
        const pos = new Vec3(packet.location.x, packet.location.y, packet.location.z);
        const posKey = `${pos.x},${pos.y},${pos.z}`;
        if (this._lastDetectedPos === posKey) return;
        this._lastDetectedPos = posKey;
        
        if (!this.pendingSetup.pos1) {
            this.pendingSetup.pos1 = pos;
            this.log(`Position 1 set: ${pos.x}, ${pos.y}, ${pos.z}. Now punch Position 2.`);
            this.notifyUser(this.pendingSetup.username, `Pos1 set at ${pos.x}, ${pos.y}, ${pos.z}. Now punch block for Pos2.`);
            this._lastDetectedPos = null;
        } else if (!this.pendingSetup.pos2) {
            const pos1Key = `${this.pendingSetup.pos1.x},${this.pendingSetup.pos1.y},${this.pendingSetup.pos1.z}`;
            if (posKey === pos1Key) return;
            
            this.pendingSetup.pos2 = pos;
            this.log(`Position 2 set: ${pos.x}, ${pos.y}, ${pos.z}`);
            
            this.bot._client.removeListener('block_break_animation', this.onPlayerAction);
            this._lastDetectedPos = null;
            this.finalizeSetup();
        }
    }

    finalizeSetup() {
        const { pos1, pos2, direction, limit, username } = this.pendingSetup;
        
        // axis: if X same -> tunnel in X, if Z same -> tunnel in Z
        const xSame = pos1.x === pos2.x;
        const zSame = pos1.z === pos2.z;
        
        let axis;
        if (xSame && zSame) {
            this.log(`Error: Pos1 and Pos2 have same X and Z. Cannot determine tunnel direction.`, 'red');
            this.notifyUser(username, `Error: Both positions have same X and Z. Punch blocks that differ in X or Z to define tunnel width.`);
            this.pendingSetup = null;
            return;
        } else if (!xSame && !zSame) {
            this.log(`Error: Pos1 and Pos2 differ in both X and Z. Cannot determine tunnel direction.`, 'red');
            this.notifyUser(username, `Error: Positions differ in both X and Z. They should only differ in one axis to define tunnel width.`);
            this.pendingSetup = null;
            return;
        } else if (xSame) {
            axis = 'x';
        } else {
            axis = 'z';
        }

        const minX = Math.min(pos1.x, pos2.x);
        const maxX = Math.max(pos1.x, pos2.x);
        const minY = Math.min(pos1.y, pos2.y);
        const maxY = Math.max(pos1.y, pos2.y);
        const minZ = Math.min(pos1.z, pos2.z);
        const maxZ = Math.max(pos1.z, pos2.z);

        const startCoord = axis === 'x' ? pos1.x : pos1.z;

        this.miningSession = {
            axis,
            direction,
            limit,
            bounds: { minX, maxX, minY, maxY, minZ, maxZ },
            startCoord,
            currentDepth: 0,
            mined: 0,
            paused: false
        };

        this.pendingSetup = null;
        this.active = true;

        const axisInfo = `Axis: ${axis.toUpperCase()}, Direction: ${direction}`;
        const boundsInfo = `Area: ${maxX - minX + 1}x${maxY - minY + 1}x${maxZ - minZ + 1}`;
        this.log(`Starting tunnel! ${axisInfo}, ${boundsInfo}`);
        this.notifyUser(username, `Tunnel started! ${axisInfo}. ${boundsInfo}. Depth: ${limit === Infinity ? 'infinite' : limit + ' blocks'}.`);

        this.mineLoop();
    }

    async mineLoop() {
        while (this.active && this.miningSession && !this.miningSession.paused) {
            const session = this.miningSession;
            
            if (session.currentDepth >= session.limit) {
                this.log('Reached depth limit. Stopping.');
                this.stop();
                return;
            }

            const depthOffset = session.direction === 'positive' 
                ? session.currentDepth 
                : -session.currentDepth;
            
            const sliceCoord = session.startCoord + depthOffset;
            const sliceMined = await this.mineSliceCompletely(session, sliceCoord);
            
            if (sliceMined) {
                session.currentDepth++;
            } else {
                await this.sleep(100);
            }

            await this.sleep(10);
        }
    }

    async mineSliceCompletely(session, sliceCoord) {
        const maxAttempts = 3;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.active || this.miningSession?.paused) return false;

            const blocksToMine = this.getSliceBlocks(session, sliceCoord);
            
            if (blocksToMine.length === 0) {
                return true;
            }

            if (attempt === 0) {
                await this.positionForSlice(session, sliceCoord, blocksToMine);
                await this.selectBestToolForSlice(blocksToMine);
            }

            for (const blockPos of blocksToMine) {
                if (!this.active || this.miningSession?.paused) return false;
                await this.mineBlockFast(blockPos, session);
            }

            const remaining = this.getSliceBlocks(session, sliceCoord);
            if (remaining.length === 0) {
                return true;
            }

            if (remaining.length > 0 && attempt < maxAttempts - 1) {
                await this.walkToFast(remaining[0]);
            }
        }

        return this.getSliceBlocks(session, sliceCoord).length === 0;
    }

    async positionForSlice(session, sliceCoord, blocksToMine) {
        const { axis, bounds } = session;
        const { minX, maxX, minY, minZ, maxZ } = bounds;
        
        let targetX, targetZ;
        if (axis === 'x') {
            targetX = sliceCoord;
            targetZ = Math.floor((minZ + maxZ) / 2);
        } else {
            targetX = Math.floor((minX + maxX) / 2);
            targetZ = sliceCoord;
        }

        const targetPos = new Vec3(targetX + 0.5, minY, targetZ + 0.5);
        const botPos = this.bot.entity.position;
        
        if (botPos.distanceTo(targetPos) > 3) {
            await this.walkToFast(targetPos);
        }
    }

    async mineBlockFast(blockPos, session) {
        let block = this.bot.blockAt(blockPos);
        if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
            return true;
        }

        const botPos = this.bot.entity.position;
        const distance = botPos.distanceTo(blockPos);

        if (distance > this.reachDistance) {
            await this.walkToFast(blockPos);
            if (this.bot.entity.position.distanceTo(blockPos) > this.reachDistance) {
                return false;
            }
        }

        block = this.bot.blockAt(blockPos);
        if (!block || block.name === 'air' || block.name === 'cave_air') {
            return true;
        }

        try {
            await this.bot.dig(block);
            session.mined++;
            return true;
        } catch (err) {
            const checkBlock = this.bot.blockAt(blockPos);
            if (!checkBlock || checkBlock.name === 'air' || checkBlock.name === 'cave_air') {
                return true;
            }
            return false;
        }
    }

    async walkToFast(targetPos) {
        const maxTicks = 30;
        let stuckCounter = 0;
        let lastPos = null;

        for (let i = 0; i < maxTicks; i++) {
            if (!this.active) break;
            
            const botPos = this.bot.entity.position;
            const dx = targetPos.x - botPos.x;
            const dz = targetPos.z - botPos.z;
            const horizontalDist = Math.sqrt(dx * dx + dz * dz);
            
            if (horizontalDist < 2) {
                this.bot.clearControlStates();
                return;
            }

            if (lastPos && botPos.distanceTo(lastPos) < 0.05) {
                stuckCounter++;
            } else {
                stuckCounter = 0;
            }
            lastPos = botPos.clone();

            this.bot.entity.yaw = Math.atan2(-dx, -dz);
            this.bot.setControlState('forward', true);
            
            if (stuckCounter > 2 || this.bot.entity.isCollidedHorizontally) {
                this.bot.setControlState('jump', true);
            } else {
                this.bot.setControlState('jump', false);
            }

            await this.sleep(50);
        }
        
        this.bot.clearControlStates();
    }

    async selectBestToolForSlice(blocks) {
        for (const pos of blocks) {
            const block = this.bot.blockAt(pos);
            if (block && block.name !== 'air') {
                await this.selectBestTool(block);
                return;
            }
        }
    }

    getSliceBlocks(session, sliceCoord) {
        const blocks = [];
        const { axis, bounds } = session;
        const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;

        if (axis === 'x') {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const pos = new Vec3(sliceCoord, y, z);
                    if (this.isMineable(pos)) {
                        blocks.push(pos);
                    }
                }
            }
        } else if (axis === 'z') {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const pos = new Vec3(x, y, sliceCoord);
                    if (this.isMineable(pos)) {
                        blocks.push(pos);
                    }
                }
            }
        } else {
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const pos = new Vec3(x, sliceCoord, z);
                    if (this.isMineable(pos)) {
                        blocks.push(pos);
                    }
                }
            }
        }

        return blocks;
    }

    isMineable(pos) {
        const block = this.bot.blockAt(pos);
        if (!block) return false;
        if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') return false;
        if (block.name === 'water' || block.name === 'lava') return false;
        if (block.name === 'bedrock') return false;
        return true;
    }

    async selectBestTool(block) {
        const tool = this.bot.pathfinder?.bestHarvestTool?.(block) || this.bot.bestHarvestTool?.(block);
        if (tool) {
            try {
                await this.bot.equip(tool, 'hand');
            } catch (e) {}
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    notifyUser(username, message) {
        if (username && this.bot) {
            this.bot.chat(`/w ${username} [AutoTunnel] ${message}`);
        }
    }

    stop() {
        this.active = false;
        if (this.pendingSetup) {
            this.bot._client.removeListener('block_break_animation', this.onPlayerAction);
            this.pendingSetup = null;
            this._lastDetectedPos = null;
        }
        if (this.miningSession) {
            const mined = this.miningSession.mined;
            this.miningSession = null;
            this.log(`Stopped. Mined ${mined} blocks total.`);
            return mined;
        }
        this.bot.clearControlStates();
        return 0;
    }

    cancel() {
        if (this.pendingSetup) {
            this.bot._client.removeListener('packet', this.onPlayerAction);
            this.pendingSetup = null;
            this.log('Setup cancelled.');
            return { ok: true, message: 'AutoTunnel setup cancelled.' };
        }
        if (this.active) {
            const mined = this.stop();
            return { ok: true, message: `AutoTunnel stopped. Mined ${mined} blocks.` };
        }
        return { ok: true, message: 'Nothing to cancel.' };
    }

    pause() {
        if (!this.active || !this.miningSession) {
            return { ok: false, error: 'No active tunnel to pause.' };
        }
        this.miningSession.paused = true;
        this.bot.clearControlStates();
        this.log('Paused.');
        return { ok: true, message: 'AutoTunnel paused.' };
    }

    resume() {
        if (!this.active || !this.miningSession) {
            return { ok: false, error: 'No active tunnel to resume.' };
        }
        if (!this.miningSession.paused) {
            return { ok: false, error: 'Tunnel is not paused.' };
        }
        this.miningSession.paused = false;
        this.log('Resumed.');
        this.mineLoop();
        return { ok: true, message: 'AutoTunnel resumed.' };
    }

    getStatus() {
        if (this.pendingSetup) {
            const setup = this.pendingSetup;
            const pos1Set = setup.pos1 ? `${setup.pos1.x},${setup.pos1.y},${setup.pos1.z}` : 'not set';
            return {
                status: 'setup',
                pos1: pos1Set,
                pos2: 'awaiting',
                direction: setup.direction,
                limit: setup.limit
            };
        }
        if (this.active && this.miningSession) {
            const session = this.miningSession;
            return {
                status: session.paused ? 'paused' : 'mining',
                axis: session.axis,
                direction: session.direction,
                limit: session.limit,
                currentDepth: session.currentDepth,
                mined: session.mined
            };
        }
        return { status: 'inactive' };
    }
}

module.exports = AutoTunnel;
