const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
    ownerUuid: '',
    minecraft: {
        host: '0b0t.org',
        username: 'ChunkPos',
        auth: 'microsoft',
        version: '1.20.4'
    },
    flight: {
        speed: 0.5,
        maxSpeed: 2.65,
        velocityUpRate: 0.1,
        velocityDownRate: 0.01,
        verticalSpeed: 0.5,
        fallMultiplier: 0,
        tickRate: 50
    },
    safety: {
        minHealth: 5,
        disconnectOnLowHealth: true,
        disconnectRadius: 2000,
        disconnectOnArrival: true
    },
    discord: {
        token: null,
        channelId: null,
        statusMessageId: null,
        updateInterval: 5000
    },
    logging: {
        directory: 'logs'
    }
};

function resolveConfigPath(filePath) {
    return filePath || path.join(process.cwd(), 'config', 'config.json');
}

function loadConfig(filePath) {
    const target = resolveConfigPath(filePath);
    let data = {};
    try {
        const raw = fs.readFileSync(target, 'utf8');
        data = JSON.parse(raw);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('[config] Failed to read config file:', err.message);
        }
    }
    return applyDefaults(data);
}

async function saveConfig(filePath, config) {
    const target = resolveConfigPath(filePath);
    const dir = path.dirname(target);
    await fs.promises.mkdir(dir, { recursive: true });
    const contents = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(target, contents, 'utf8');
}

function watchConfig(filePath, onChange) {
    if (typeof onChange !== 'function') {
        return () => {};
    }
    const target = resolveConfigPath(filePath);
    const listener = () => {
        try {
            const next = loadConfig(target);
            onChange(next);
        } catch (err) {
            console.error('[config] Failed to reload config:', err.message);
        }
    };
    try {
        fs.watchFile(target, { interval: 1000 }, listener);
    } catch (err) {
        console.error('[config] Failed to watch config file:', err.message);
    }
    return () => fs.unwatchFile(target, listener);
}

function applyDefaults(raw = {}) {
    const result = { ...DEFAULT_CONFIG, ...raw };
    result.minecraft = { ...DEFAULT_CONFIG.minecraft, ...raw.minecraft };
    result.flight = { ...DEFAULT_CONFIG.flight, ...raw.flight };
    result.safety = { ...DEFAULT_CONFIG.safety, ...raw.safety };
    result.discord = { ...DEFAULT_CONFIG.discord, ...raw.discord };
    result.logging = { ...DEFAULT_CONFIG.logging, ...raw.logging };
    return result;
}

module.exports = {
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    watchConfig,
    applyDefaults
};
