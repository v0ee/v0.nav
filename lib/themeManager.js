const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { DEFAULT_THEME_CONFIG } = require('./themeDefaults');

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return '';
    }
}

class ThemeManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.filePath = path.resolve(options.filePath || path.join(process.cwd(), 'config', 'themes.json'));
        this.defaults = options.defaults ? deepClone(options.defaults) : deepClone(DEFAULT_THEME_CONFIG);
        this.config = this.loadOrInitializeConfig();
        this.configFingerprint = stableStringify(this.config);
        this.watchListener = null;
        this.watchFile();
    }

    loadOrInitializeConfig() {
        const diskConfig = this.readConfigFromDisk();
        if (diskConfig) {
            const normalized = this.normalizeConfig(diskConfig);
            if (stableStringify(diskConfig) !== stableStringify(normalized)) {
                this.writeConfigSync(normalized);
            }
            return normalized;
        }
        this.writeConfigSync(this.defaults);
        return deepClone(this.defaults);
    }

    normalizeConfig(raw = {}) {
        const normalized = {
            activeTheme: typeof raw.activeTheme === 'string' ? raw.activeTheme : this.defaults.activeTheme,
            themes: {}
        };
        const incomingThemes = raw.themes && typeof raw.themes === 'object' ? raw.themes : {};
        Object.keys(incomingThemes).forEach(name => {
            const def = incomingThemes[name];
            if (def && typeof def === 'object') {
                normalized.themes[name] = deepClone(def);
            }
        });
        Object.keys(this.defaults.themes || {}).forEach(name => {
            if (!normalized.themes[name]) {
                normalized.themes[name] = deepClone(this.defaults.themes[name]);
            }
        });
        if (!Object.keys(normalized.themes).length) {
            normalized.themes = deepClone(this.defaults.themes);
        }
        if (!normalized.themes[normalized.activeTheme]) {
            normalized.activeTheme = this.defaults.activeTheme;
        }
        return normalized;
    }

    readConfigFromDisk() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('[ThemeManager] Failed to read theme file:', err.message);
            }
            return null;
        }
    }

    writeConfigSync(config) {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf8');
        } catch (err) {
            console.error('[ThemeManager] Failed to write theme file:', err.message);
        }
    }

    async writeConfig(config) {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(this.filePath, JSON.stringify(config, null, 2), 'utf8');
    }

    getState() {
        return deepClone(this.config);
    }

    getActiveThemeName() {
        return this.config.activeTheme;
    }

    getActiveThemeDefinition() {
        return this.config.themes[this.config.activeTheme] || null;
    }

    getActivePanels() {
        const active = this.getActiveThemeDefinition();
        return deepClone(active && active.panels ? active.panels : {});
    }

    listThemes() {
        return Object.entries(this.config.themes || {}).map(([name, def]) => ({
            name,
            label: def?.label || name,
            description: def?.description || ''
        }));
    }

    hasTheme(name) {
        return !!(name && this.config.themes && this.config.themes[name]);
    }

    async setActiveTheme(name) {
        if (!this.hasTheme(name)) {
            throw new Error(`Theme "${name}" not found.`);
        }
        if (this.config.activeTheme === name) {
            return { changed: false };
        }
        const next = this.getState();
        next.activeTheme = name;
        await this.writeConfig(next);
        this.applyConfig(next);
        return { changed: true };
    }

    reloadFromDisk() {
        const diskConfig = this.readConfigFromDisk();
        if (!diskConfig) return;
        const normalized = this.normalizeConfig(diskConfig);
        const fingerprint = stableStringify(normalized);
        if (fingerprint === this.configFingerprint) {
            return;
        }
        this.applyConfig(normalized);
    }

    applyConfig(config) {
        this.config = this.normalizeConfig(config);
        this.configFingerprint = stableStringify(this.config);
        this.emit('change', {
            activeTheme: this.getActiveThemeName(),
            panelConfig: this.getActivePanels()
        });
    }

    watchFile() {
        if (this.watchListener) return;
        this.watchListener = () => this.reloadFromDisk();
        fs.watchFile(this.filePath, { interval: 1000 }, this.watchListener);
    }

    close() {
        if (this.watchListener) {
            fs.unwatchFile(this.filePath, this.watchListener);
            this.watchListener = null;
        }
    }
}

function createThemeManager(options = {}) {
    return new ThemeManager(options);
}

module.exports = {
    ThemeManager,
    createThemeManager
};
