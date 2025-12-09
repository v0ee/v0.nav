const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { createBotManager } = require('../core/createBot');
const { createSegment } = require('../cli/colors');

const STAGGER_DELAY_MS = 5000;
const MAX_CHAT_LOGS = 400;


class MultiBotManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.rootDir = options.rootDir || process.cwd();
        this.logger = options.logger;
        this.accessControl = options.accessControl;
        this.themeManager = options.themeManager;
        this.commandRouter = options.commandRouter;
        this.logChatMessage = options.logChatMessage;
        this.forwardSystemLog = options.forwardSystemLog;
        this.baseConfig = options.baseConfig || {};
        this.saveConfig = options.saveConfig;
        this.instanceManager = options.instanceManager;
        
        this.runningInstances = new Map();
        this.instanceChatLogs = new Map();
        this.activeInstanceId = null; // which instance is "focused" for commands
        
        this.multiStateFile = path.join(this.rootDir, 'data', 'multi-instance-state.json');
    }


    loadState() {
        try {
            if (fs.existsSync(this.multiStateFile)) {
                const data = JSON.parse(fs.readFileSync(this.multiStateFile, 'utf8'));
                return data;
            }
        } catch (err) {
            this.forwardSystemLog?.(`Failed to load multi-instance state: ${err.message}`, 'yellow');
        }
        return { runningInstanceIds: [], activeInstanceId: null };
    }


    saveState() {
        try {
            const state = {
                runningInstanceIds: Array.from(this.runningInstances.keys()),
                activeInstanceId: this.activeInstanceId,
                savedAt: Date.now()
            };
            const dir = path.dirname(this.multiStateFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.multiStateFile, JSON.stringify(state, null, 2));
        } catch (err) {
            this.forwardSystemLog?.(`Failed to save multi-instance state: ${err.message}`, 'yellow');
        }
    }

    /**
     * Restore previously running instances with staggered connections
     */
    async restorePreviousSession() {
        const state = this.loadState();
        if (!state.runningInstanceIds || !state.runningInstanceIds.length) {
            return false;
        }

        if (!this.instanceManager) {
            this.forwardSystemLog?.('Cannot restore session: no instance manager', 'yellow');
            return false;
        }

        const instancesToStart = [];
        for (const instanceId of state.runningInstanceIds) {
            const instance = this.instanceManager.getInstance(instanceId);
            if (instance) {
                instancesToStart.push(instance);
            }
        }

        if (instancesToStart.length === 0) {
            return false;
        }

        this.forwardSystemLog?.(`Restoring ${instancesToStart.length} instance(s) from previous session...`, 'cyan');
        
        await this.startInstancesStaggered(instancesToStart);

        if (state.activeInstanceId && this.runningInstances.has(state.activeInstanceId)) {
            this.setActiveInstance(state.activeInstanceId);
        }

        return true;
    }

    /**
     * 0b0t hates simultaneous connections
     */
    async startInstancesStaggered(instances) {
        for (let i = 0; i < instances.length; i++) {
            const instance = instances[i];
            
            if (i > 0) {
                this.forwardSystemLog?.(`Waiting ${STAGGER_DELAY_MS / 1000}s before starting next instance...`, 'gray');
                await this.delay(STAGGER_DELAY_MS);
            }
            
            this.startInstance(instance);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * i dont know why this is necessary but whatever
     */
    getInstanceChatLogs(instanceId) {
        if (!this.instanceChatLogs.has(instanceId)) {
            this.instanceChatLogs.set(instanceId, []);
        }
        return this.instanceChatLogs.get(instanceId);
    }


    addChatLogEntry(instanceId, entry) {
        const logs = this.getInstanceChatLogs(instanceId);
        logs.push(entry);
        if (logs.length > MAX_CHAT_LOGS) {
            logs.shift();
        }
    }


    startInstance(instance) {
        if (!instance || !instance.id) {
            this.forwardSystemLog?.('Cannot start instance: invalid instance data', 'red');
            return null;
        }

        if (this.runningInstances.has(instance.id)) {
            this.forwardSystemLog?.(`Instance "${instance.name}" is already running`, 'yellow');
            return this.runningInstances.get(instance.id).botManager;
        }

        const instanceDataDir = path.join(this.rootDir, 'data', 'instances', instance.id);
        if (!fs.existsSync(instanceDataDir)) {
            fs.mkdirSync(instanceDataDir, { recursive: true });
        }

        const instanceConfig = {
            ...this.baseConfig,
            minecraft: { ...this.baseConfig.minecraft, ...instance.minecraft }
        };

        const options = {
            ...instanceConfig.minecraft,
            checkTimeoutInterval: 60000,
            closeTimeout: 120000,
            onMsaCode: (data) => {
                this.forwardSystemLog?.('========================================', 'cyan');
                this.forwardSystemLog?.(`[${instance.name}] Microsoft Login Required!`, 'yellow');
                this.forwardSystemLog?.(`Go to: ${data.verification_uri}`, 'cyan');
                this.forwardSystemLog?.(`Enter code: ${data.user_code}`, 'green');
                this.forwardSystemLog?.('========================================', 'cyan');
            }
        };

        this.instanceChatLogs.set(instance.id, []);

        const botManager = createBotManager({
            options,
            files: {
                state: path.join(instanceDataDir, 'state.json'),
                waypoints: path.join(instanceDataDir, 'waypoints.json'),
                config: path.join(this.rootDir, 'config', 'config.json')
            },
            getConfig: () => instanceConfig,
            logChatMessage: (payload, color) => {
                let entry;
                if (Array.isArray(payload)) {
                    const prefixedSegments = [
                        createSegment(`[${instance.name}] `, { color: 'gray' }),
                        ...payload
                    ];
                    entry = { type: 'segments', segments: prefixedSegments, instanceId: instance.id };
                } else if (typeof payload === 'string') {
                    entry = { type: 'system', text: `[${instance.name}] ${payload}`, color, instanceId: instance.id };
                } else {
                    entry = { type: 'segments', segments: payload, instanceId: instance.id };
                }

                this.addChatLogEntry(instance.id, entry);

                if (instance.id === this.activeInstanceId) {
                    if (entry.type === 'segments') {
                        this.logChatMessage?.(entry.segments, color);
                    } else {
                        this.logChatMessage?.(entry.text, entry.color);
                    }
                }
            },
            forwardSystemLog: (msg, color) => {
                this.forwardSystemLog?.(`[${instance.name}] ${msg}`, color);
            },
            commandRouter: this.commandRouter,
            accessControl: this.accessControl,
            logger: this.logger,
            saveConfig: this.saveConfig,
            themeManager: this.themeManager
        });

        const entry = {
            botManager,
            instance,
            status: 'starting',
            startedAt: Date.now()
        };

        this.runningInstances.set(instance.id, entry);

        if (!this.activeInstanceId) {
            this.activeInstanceId = instance.id;
        }

        botManager.start();
        entry.status = 'running';

        this.forwardSystemLog?.(`Started instance: ${instance.name} (${instance.minecraft?.host})`, 'green');
        this.emit('instanceStarted', { instanceId: instance.id, instance });

        this.saveState();

        return botManager;
    }


    stopInstance(instanceId, reason = 'manual stop') {
        const entry = this.runningInstances.get(instanceId);
        if (!entry) {
            this.forwardSystemLog?.(`Instance not running: ${instanceId}`, 'yellow');
            return false;
        }

        entry.status = 'stopping';
        entry.botManager.requestShutdown({ 
            reason, 
            reconnect: false, 
            forceExit: false 
        });

        setTimeout(() => {
            this.runningInstances.delete(instanceId);
     
            if (this.activeInstanceId === instanceId) {
                const remaining = Array.from(this.runningInstances.keys());
                this.activeInstanceId = remaining[0] || null;
                if (this.activeInstanceId) {
                    this.emit('activeChanged', { instanceId: this.activeInstanceId });
                }
            }

            this.forwardSystemLog?.(`Stopped instance: ${entry.instance.name}`, 'yellow');
            this.emit('instanceStopped', { instanceId, instance: entry.instance });
            
            this.saveState();
        }, 500);

        return true;
    }


    stopAll(reason = 'shutdown') {
        if (reason === 'shutdown') {
            try {
                if (fs.existsSync(this.multiStateFile)) {
                    fs.unlinkSync(this.multiStateFile);
                }
            } catch (err) {
            }
        }
        for (const [instanceId] of this.runningInstances) {
            this.stopInstance(instanceId, reason);
        }
    }

    setActiveInstance(instanceId) {
        if (!this.runningInstances.has(instanceId)) {
            return false;
        }
        const previousId = this.activeInstanceId;
        this.activeInstanceId = instanceId;
        
        this.emit('activeChanged', { 
            instanceId, 
            previousInstanceId: previousId,
            chatLogs: this.getInstanceChatLogs(instanceId)
        });
        
        this.saveState();
        
        return true;
    }


    getActiveBot() {
        if (!this.activeInstanceId) return null;
        const entry = this.runningInstances.get(this.activeInstanceId);
        return entry?.botManager?.getBot() || null;
    }

    getActiveBotManager() {
        if (!this.activeInstanceId) return null;
        const entry = this.runningInstances.get(this.activeInstanceId);
        return entry?.botManager || null;
    }

    getActiveInstanceId() {
        return this.activeInstanceId;
    }

    getActiveEntry() {
        if (!this.activeInstanceId) return null;
        return this.runningInstances.get(this.activeInstanceId) || null;
    }

    /**
     * Check if an instance is running
     */
    isRunning(instanceId) {
        return this.runningInstances.has(instanceId);
    }

    /**
     * Get all running instances
     */
    getRunningInstances() {
        return Array.from(this.runningInstances.values()).map(entry => ({
            id: entry.instance.id,
            name: entry.instance.name,
            host: entry.instance.minecraft?.host,
            status: entry.status,
            startedAt: entry.startedAt,
            isActive: entry.instance.id === this.activeInstanceId
        }));
    }

    /**
     * Get count of running instances
     */
    getRunningCount() {
        return this.runningInstances.size;
    }

    /**
     * Get bot manager for a specific instance
     */
    getBotManager(instanceId) {
        const entry = this.runningInstances.get(instanceId);
        return entry?.botManager || null;
    }

    /**
     * Refresh status for all running instances
     */
    getStatusInfo() {
        const instances = [];
        for (const [id, entry] of this.runningInstances) {
            const bot = entry.botManager.getBot();
            instances.push({
                id,
                name: entry.instance.name,
                host: entry.instance.minecraft?.host,
                isActive: id === this.activeInstanceId,
                connected: bot && bot.entity ? true : false,
                connectedAt: entry.botManager.getConnectedAt(),
                elytraFly: entry.botManager.getElytraFly(),
                autoTunnel: entry.botManager.getAutoTunnel()
            });
        }
        return instances;
    }
}

function createMultiBotManager(options = {}) {
    return new MultiBotManager(options);
}

module.exports = {
    MultiBotManager,
    createMultiBotManager
};
