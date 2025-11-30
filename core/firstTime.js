const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
async function runFirstTimeSetup({ configPath, themesPath, dataDir }) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question, fallback = '') => new Promise(resolve => {
        const suffix = fallback ? ` (${fallback})` : '';
        rl.question(`${question}${suffix}: `, answer => {
            const value = String(answer || '').trim();
            resolve(value || fallback);
        });
    });
    const askYesNo = async (question, defaultYes = false) => {
        const hint = defaultYes ? 'Y/n' : 'y/N';
        const raw = await ask(`${question} [${hint}]`, defaultYes ? 'y' : 'n');
        return /^y(es)?$/i.test(raw);
    };

    try {
        console.log('\n=== v0.nav First-Time Setup ===');
        console.log('This wizard writes config/config.json and config/themes.json, then creates data/v0.nav');
        console.log('Press Ctrl+C any time to abort.\n');

        const exampleConfig = await loadJsonWithFallback(
            configPath,
            path.join(__dirname, '..', 'config', 'config.example.json')
        );
        const config = { ...exampleConfig };

        config.minecraft = { ...(exampleConfig.minecraft || {}) };
        config.flight = { ...(exampleConfig.flight || {}) };
        config.safety = { ...(exampleConfig.safety || {}) };
        config.discord = { ...(exampleConfig.discord || {}) };

        const host = await ask('Minecraft server host', config.minecraft.host);
        config.minecraft.host = host;
        const username = await ask('Bot account username (ign)', config.minecraft.username);
        config.minecraft.username = username;
        const auth = await ask('Authentication mode (microsoft/offline)', config.minecraft.auth || 'microsoft');
        config.minecraft.auth = auth;
        const ownerUuid = await ask('Owner UUID (used for admin access)', config.ownerUuid || '');
        config.ownerUuid = ownerUuid;

        const needsDiscord = await askYesNo('Configure Discord bridge now?', Boolean(config.discord?.token));
        if (needsDiscord) {
            const token = await ask('Discord bot token', config.discord?.token || '');
            const channelId = await ask('Discord status channel ID', config.discord?.channelId || '');
            config.discord = {
                ...config.discord,
                token: token || null,
                channelId: channelId || null,
                statusMessageId: config.discord?.statusMessageId || null,
                updateInterval: config.discord?.updateInterval || 5000
            };
        } else {
            config.discord = {
                ...config.discord,
                token: null,
                channelId: null
            };
        }

        await ensureDir(path.dirname(configPath));
        await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(`\n✔ Saved ${configPath}`);

        await bootstrapThemes(themesPath);
        await ensureDir(dataDir);
        const navPath = path.join(dataDir, 'v0.nav');
        const navStamp = { initializedAt: new Date().toISOString(), version: 'v0' };
        await fsp.writeFile(navPath, JSON.stringify(navStamp, null, 2));
        console.log(`✔ Created ${navPath}`);

        const launchNow = await askYesNo('\nSetup complete. Launch v0.nav now?', true);
        return { launchBot: launchNow };
    } finally {
        rl.close();
    }
}

async function loadJsonWithFallback(targetPath, fallbackPath) {
    try {
        const raw = await fsp.readFile(targetPath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        const raw = await fsp.readFile(fallbackPath, 'utf8');
        return JSON.parse(raw);
    }
}

async function ensureDir(dirPath) {
    await fsp.mkdir(dirPath, { recursive: true });
}

async function bootstrapThemes(themesPath) {
    try {
        await fsp.access(themesPath);
        return;
    } catch (_) {
        const fallback = path.join(__dirname, '..', 'config', 'themes.example.json');
        const raw = await fsp.readFile(fallback, 'utf8');
        await ensureDir(path.dirname(themesPath));
        await fsp.writeFile(themesPath, raw);
        console.log(`✔ Seeded ${themesPath} from example`);
    }
}

module.exports = runFirstTimeSetup;
