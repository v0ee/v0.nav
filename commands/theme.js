module.exports = {
    name: 'theme',
    description: 'List or switch CLI theme presets',
    usage: '.theme [list|set <name>]',
    cliOnly: true,
    handler: async ({ args = [], respond = () => {}, themeManager }) => {
        if (!themeManager) {
            respond('Theme manager not configured.', 'red');
            return;
        }

        const sub = (args[0] || '').toLowerCase();
        const wantsList = !args.length || sub === 'list';
        if (wantsList) {
            const active = themeManager.getActiveThemeName();
            const entries = themeManager.listThemes();
            const summary = entries.map(entry => {
                const tag = entry.name === active ? '*' : ' ';
                const label = entry.label || entry.name;
                const desc = entry.description ? ` – ${entry.description}` : '';
                return `${tag} ${entry.name} (${label})${desc}`;
            });
            respond(summary.length ? summary.join('\n') : 'No themes available.');
            return;
        }

        let target = args[0];
        if (sub === 'set') {
            target = args[1];
        }
        if (!target) {
            respond('Usage: .theme [list|set <name>]', 'red');
            return;
        }
        const themeName = String(target).toLowerCase();
        const available = themeManager.listThemes();
        const match = available.find(entry => entry.name.toLowerCase() === themeName);
        if (!match) {
            respond(`Theme "${target}" not found. Run .theme list to view options.`, 'red');
            return;
        }
        try {
            const result = await themeManager.setActiveTheme(match.name);
            const active = themeManager.getActiveThemeName();
            if (result && result.changed) {
                respond(`Theme switched to ${active}.`);
            } else {
                respond(`Theme "${active}" already active.`);
            }
        } catch (err) {
            respond(err?.message || 'Failed to change theme.', 'red');
        }
    }
};
