const fs = require('fs');
const path = require('path');
const https = require('https');

const { normalizeUuid, isUuid } = require('../utils/uuid');

class AccessControl {
    constructor({ filePath, legacyFile, ownerUuid, logger }) {
        if (!filePath) {
            throw new Error('AccessControl requires a whitelist file path');
        }
        this.filePath = filePath;
        this.legacyFile = legacyFile;
        this.ownerUuid = normalizeUuid(ownerUuid);
        this.logger = logger;
        this.entries = new Map();
        this.nameIndex = new Map();
        this.loadFromDisk();
        this.watch();
    }

    setOwnerUuid(ownerUuid) {
        this.ownerUuid = normalizeUuid(ownerUuid);
    }

    loadFromDisk() {
        try {
            this.ensureFile();
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = raw ? JSON.parse(raw) : { entries: [] };
            this.entries.clear();
            this.nameIndex.clear();
            (parsed.entries || []).forEach(entry => this.indexEntry(entry));
        } catch (err) {
            console.error('[AccessControl] Failed to load whitelist:', err.message);
        }
    }

    ensureFile() {
        if (fs.existsSync(this.filePath)) return;
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        const entries = this.migrateLegacyEntries();
        fs.writeFileSync(this.filePath, JSON.stringify({ entries }, null, 2));
    }

    migrateLegacyEntries() {
        if (!this.legacyFile || !fs.existsSync(this.legacyFile)) {
            return [];
        }
        try {
            const lines = fs.readFileSync(this.legacyFile, 'utf8')
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);
            const stamp = new Date().toISOString();
            return lines.map(uuid => ({
                uuid: normalizeUuid(uuid),
                lastSeenAs: null,
                role: 'whitelist',
                addedBy: 'migration',
                addedAt: stamp
            }));
        } catch (err) {
            console.error('[AccessControl] Legacy whitelist migration failed:', err.message);
            return [];
        }
    }

    indexEntry(entry) {
        if (!entry || !entry.uuid) return;
        const normalized = normalizeUuid(entry.uuid);
        if (!normalized) return;
        const record = {
            uuid: normalized,
            lastSeenAs: entry.lastSeenAs || null,
            role: entry.role === 'admin' ? 'admin' : 'whitelist',
            addedBy: entry.addedBy || 'unknown',
            addedAt: entry.addedAt || new Date().toISOString()
        };
        this.entries.set(normalized, record);
        if (record.lastSeenAs) {
            this.nameIndex.set(record.lastSeenAs.toLowerCase(), normalized);
        }
    }

    watch() {
        fs.watchFile(this.filePath, { interval: 1000 }, () => this.loadFromDisk());
    }

    async addEntry({ identifier, role = 'whitelist', addedBy = 'system' }) {
        const profile = await this.resolveProfile(identifier);
        if (!profile || !profile.uuid) {
            throw new Error('Unable to resolve UUID for provided identifier');
        }
        const normalizedUuid = profile.uuid;
        const entry = {
            uuid: normalizedUuid,
            lastSeenAs: profile.username || null,
            role: role === 'admin' ? 'admin' : 'whitelist',
            addedBy,
            addedAt: new Date().toISOString()
        };
        this.entries.set(normalizedUuid, entry);
        if (entry.lastSeenAs) {
            this.nameIndex.set(entry.lastSeenAs.toLowerCase(), normalizedUuid);
        }
        this.persist();
        return entry;
    }

    persist() {
        try {
            const payload = {
                entries: Array.from(this.entries.values())
            };
            fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
        } catch (err) {
            console.error('[AccessControl] Failed to save whitelist:', err.message);
        }
    }

    async removeEntry(identifier) {
        let uuid = null;
        
        if (isUuid(identifier)) {
            uuid = normalizeUuid(identifier);
        } else {
            const key = identifier.toLowerCase();
            uuid = this.nameIndex.get(key);
            
            if (!uuid) {
                for (const entry of this.entries.values()) {
                    if (entry.lastSeenAs && entry.lastSeenAs.toLowerCase() === key) {
                        uuid = entry.uuid;
                        break;
                    }
                }
            }
        }
        
        if (!uuid || !this.entries.has(uuid)) {
            return null;
        }
        
        const entry = this.entries.get(uuid);
        this.entries.delete(uuid);
        
        if (entry.lastSeenAs) {
            this.nameIndex.delete(entry.lastSeenAs.toLowerCase());
        }
        
        this.persist();
        return entry;
    }

    listEntries() {
        return Array.from(this.entries.values());
    }

    recordSeen({ uuid, username }) {
        const normalizedUuid = normalizeUuid(uuid);
        if (!normalizedUuid) return;
        const entry = this.entries.get(normalizedUuid);
        if (!entry) return;
        if (username && username !== entry.lastSeenAs) {
            entry.lastSeenAs = username;
            this.nameIndex.set(username.toLowerCase(), normalizedUuid);
            this.persist();
        }
    }

    getRole({ uuid, username }) {
        const normalizedUuid = normalizeUuid(uuid);
        if (normalizedUuid && normalizedUuid === this.ownerUuid) {
            return 'admin';
        }
        if (normalizedUuid && this.entries.has(normalizedUuid)) {
            return this.entries.get(normalizedUuid).role;
        }
        if (username) {
            const key = username.toLowerCase();
            const mappedUuid = this.nameIndex.get(key);
            if (mappedUuid) {
                return this.entries.get(mappedUuid)?.role || null;
            }
        }
        return null;
    }

    isAdmin({ uuid, username }) {
        return this.getRole({ uuid, username }) === 'admin';
    }

    isTrusted({ uuid, username }) {
        const role = this.getRole({ uuid, username });
        return role === 'admin' || role === 'whitelist';
    }

    isOwner({ uuid, username }) {
        const normalizedUuid = normalizeUuid(uuid);
        if (normalizedUuid && normalizedUuid === this.ownerUuid) {
            return true;
        }
        if (username) {
            const key = username.toLowerCase();
            const mappedUuid = this.nameIndex.get(key);
            if (mappedUuid && mappedUuid === this.ownerUuid) {
                return true;
            }
        }
        return false;
    }

    async resolveProfile(identifier) {
        if (!identifier) return null;
        if (isUuid(identifier)) {
            return { uuid: normalizeUuid(identifier), username: null };
        }
        const username = identifier.trim();
        const data = await fetchJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`);
        if (!data || !data.id) {
            throw new Error(`Player "${username}" not found`);
        }
        return {
            uuid: formatUuid(data.id),
            username: data.name || username
        };
    }
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const body = Buffer.concat(chunks).toString('utf8');
                if (!body) return resolve(null);
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

function formatUuid(value) {
    const normalized = normalizeUuid(value);
    return normalized;
}

module.exports = {
    AccessControl
};
