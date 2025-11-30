const fs = require('fs');
const path = require('path');

class CommandRouter {
    constructor(options = {}) {
        this.prefix = options.prefix || '.';
        this.commands = new Map();
        this.aliases = new Map();
        this.logger = options.logger || null;
    }

    register(definition) {
        if (!definition || !definition.name || typeof definition.handler !== 'function') {
            throw new Error('Command definition requires name and handler');
        }
        const name = definition.name.toLowerCase();
        if (this.commands.has(name)) {
            throw new Error(`Command "${name}" already registered`);
        }
        const command = {
            name,
            description: definition.description || '',
            usage: definition.usage || '',
            examples: definition.examples || [],
            aliases: Array.isArray(definition.aliases) ? definition.aliases.map(alias => alias.toLowerCase()) : [],
            handler: definition.handler,
            hidden: !!definition.hidden
        };
        this.commands.set(name, command);
        command.aliases.forEach(alias => {
            this.aliases.set(alias, name);
        });
        return () => this.unregister(name);
    }

    unregister(name) {
        const canonical = this.commands.get(name);
        if (!canonical) return;
        canonical.aliases.forEach(alias => this.aliases.delete(alias));
        this.commands.delete(name);
    }

    listCommands(includeHidden = false) {
        return Array.from(this.commands.values()).filter(cmd => includeHidden || !cmd.hidden);
    }

    parseInput(raw) {
        if (!raw) return { name: '', args: [] };
        const trimmed = raw.trim();
        if (!trimmed) return { name: '', args: [] };
        const withoutPrefix = this.prefix && trimmed.startsWith(this.prefix)
            ? trimmed.slice(this.prefix.length)
            : trimmed;
        const [name, ...rest] = withoutPrefix.split(/\s+/);
        return { name: name ? name.toLowerCase() : '', args: rest };
    }

    resolve(name) {
        if (!name) return null;
        const canonical = this.commands.get(name);
        if (canonical) return canonical;
        const mapped = this.aliases.get(name);
        return mapped ? this.commands.get(mapped) : null;
    }

    async execute(raw, context = {}) {
        const { name, args } = this.parseInput(raw);
        if (!name) {
            return { ok: false, error: 'No command provided.' };
        }
        return this.executeCommand(name, args, context);
    }

    async executeCommand(name, args = [], context = {}) {
        const command = this.resolve(name.toLowerCase());
        if (!command) {
            const failure = { ok: false, error: `Unknown command "${name}".` };
            this.logCommand(name, args, context, failure);
            return failure;
        }
        try {
            const result = await command.handler({
                ...context,
                args,
                command,
                router: this
            });
            const payload = { ok: true, result };
            this.logCommand(command.name, args, context, payload);
            return payload;
        } catch (err) {
            const failure = { ok: false, error: err };
            this.logCommand(command.name, args, context, failure);
            return failure;
        }
    }

    logCommand(name, args, context, outcome) {
        if (!this.logger) return;
        const initiator = context?.initiator || null;
        this.logger.logCommand({
            command: name,
            args,
            initiator,
            ok: !!outcome?.ok,
            error: outcome?.ok ? null : serializeError(outcome?.error)
        });
    }
}

function createCommandRouter(options = {}) {
    const router = new CommandRouter(options);
    if (options.loadCommands !== false) {
        loadCommandModules(router, options.commandsDir);
    }
    return router;
}

function loadCommandModules(router, commandsDir) {
    if (!router) return;
    const targetDir = commandsDir || path.join(__dirname, 'commands');
    let entries = [];
    try {
        entries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch (err) {
        return;
    }
    entries.forEach(entry => {
        if (!entry.isFile() || !entry.name.endsWith('.js')) return;
        const fullPath = path.join(targetDir, entry.name);
        try {
            const mod = require(fullPath);
            registerCommandDefinition(router, mod, fullPath);
        } catch (err) {
            console.error(`[commandRouter] Failed to load ${entry.name}:`, err.message);
        }
    });
}

function registerCommandDefinition(router, mod, sourcePath) {
    if (!mod) return;
    const definitions = Array.isArray(mod) ? mod : mod.commands ? mod.commands : [mod];
    definitions.forEach(def => {
        if (!def || !def.name) {
            console.warn(`[commandRouter] Skipping invalid command export from ${sourcePath}`);
            return;
        }
        router.register(def);
    });
}

function serializeError(err) {
    if (!err) return null;
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    return JSON.stringify(err);
}

module.exports = {
    CommandRouter,
    createCommandRouter,
    loadCommandModules
};
