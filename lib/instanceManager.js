const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');

const DEFAULT_INSTANCES_FILE = 'instances.json';

class InstanceManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.filePath = options.filePath || path.join(process.cwd(), 'config', DEFAULT_INSTANCES_FILE);
        this.instances = [];
        this.activeInstanceId = null;
        this.loaded = false;
    }

    async load() {
        try {
            const raw = await fsp.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            this.instances = Array.isArray(data.instances) ? data.instances : [];
            this.activeInstanceId = data.activeInstanceId || null;
            
            if (this.activeInstanceId && !this.getInstance(this.activeInstanceId)) {
                this.activeInstanceId = this.instances[0]?.id || null;
            }
            
            this.loaded = true;
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') {
                await this.createDefault();
                return true;
            }
            console.error('[InstanceManager] Failed to load instances:', err.message);
            return false;
        }
    }

    loadSync() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            this.instances = Array.isArray(data.instances) ? data.instances : [];
            this.activeInstanceId = data.activeInstanceId || null;
            
            if (this.activeInstanceId && !this.getInstance(this.activeInstanceId)) {
                this.activeInstanceId = this.instances[0]?.id || null;
            }
            
            this.loaded = true;
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') {
                this.createDefaultSync();
                return true;
            }
            console.error('[InstanceManager] Failed to load instances:', err.message);
            return false;
        }
    }

    async createDefault() {
        const defaultInstance = this.createInstanceObject('Default', {
            host: '0b0t.org',
            username: 'FlightBot',
            auth: 'microsoft',
            version: '1.20.4'
        });
        
        this.instances = [defaultInstance];
        this.activeInstanceId = defaultInstance.id;
        this.loaded = true;
        
        await this.save();
    }

    createDefaultSync() {
        const defaultInstance = this.createInstanceObject('Default', {
            host: '0b0t.org',
            username: 'FlightBot',
            auth: 'microsoft',
            version: '1.20.4'
        });
        
        this.instances = [defaultInstance];
        this.activeInstanceId = defaultInstance.id;
        this.loaded = true;
        
        this.saveSync();
    }

    async save() {
        const dir = path.dirname(this.filePath);
        await fsp.mkdir(dir, { recursive: true });
        const data = {
            activeInstanceId: this.activeInstanceId,
            instances: this.instances
        };
        await fsp.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    saveSync() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            activeInstanceId: this.activeInstanceId,
            instances: this.instances
        };
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    createInstanceObject(name, minecraft = {}) {
        return {
            id: this.generateId(),
            name: name || `Instance ${this.instances.length + 1}`,
            createdAt: Date.now(),
            minecraft: {
                host: minecraft.host || '0b0t.org',
                username: minecraft.username || 'FlightBot',
                auth: minecraft.auth || 'microsoft',
                version: minecraft.version || '1.20.4'
            }
        };
    }

    generateId() {
        return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    getInstances() {
        return this.instances.slice();
    }

    getInstance(id) {
        return this.instances.find(inst => inst.id === id) || null;
    }

    getActiveInstance() {
        if (!this.activeInstanceId) return this.instances[0] || null;
        return this.getInstance(this.activeInstanceId) || this.instances[0] || null;
    }

    getActiveInstanceId() {
        return this.activeInstanceId;
    }

    async addInstance(name, minecraft = {}) {
        const instance = this.createInstanceObject(name, minecraft);
        this.instances.push(instance);
        await this.save();
        this.emit('instanceAdded', instance);
        return instance;
    }

    addInstanceSync(name, minecraft = {}) {
        const instance = this.createInstanceObject(name, minecraft);
        this.instances.push(instance);
        this.saveSync();
        this.emit('instanceAdded', instance);
        return instance;
    }

    async removeInstance(id) {
        const index = this.instances.findIndex(inst => inst.id === id);
        if (index === -1) return false;
        
        const removed = this.instances.splice(index, 1)[0];
        
        if (this.activeInstanceId === id) {
            this.activeInstanceId = this.instances[0]?.id || null;
        }
        
        await this.save();
        this.emit('instanceRemoved', removed);
        return true;
    }

    async updateInstance(id, updates = {}) {
        const instance = this.getInstance(id);
        if (!instance) return null;
        
        if (updates.name !== undefined) {
            instance.name = updates.name;
        }
        if (updates.minecraft) {
            instance.minecraft = { ...instance.minecraft, ...updates.minecraft };
        }
        
        await this.save();
        this.emit('instanceUpdated', instance);
        return instance;
    }

    async switchInstance(id) {
        const instance = this.getInstance(id);
        if (!instance) return null;
        
        const previousId = this.activeInstanceId;
        this.activeInstanceId = id;
        
        await this.save();
        this.emit('instanceSwitched', { previous: previousId, current: id, instance });
        return instance;
    }

    switchInstanceSync(id) {
        const instance = this.getInstance(id);
        if (!instance) return null;
        
        const previousId = this.activeInstanceId;
        this.activeInstanceId = id;
        
        this.saveSync();
        this.emit('instanceSwitched', { previous: previousId, current: id, instance });
        return instance;
    }

    getInstanceCount() {
        return this.instances.length;
    }
}

function createInstanceManager(options = {}) {
    return new InstanceManager(options);
}

module.exports = {
    InstanceManager,
    createInstanceManager
};
