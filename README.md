![v0 logo](assets/thing.svg)

v0.nav is a mineflayer-based automation toolkit for 0b0t.org. it ships with a rich terminal ui, shared command router, discord integration, elytra autopilot, tpa helper, and persistent access control.

## features
- **modular mineflayer stack** – `core/createBot` wires mineflayer, elytrafly, commander, discord, and safety checks with shared config/state adapters.
- **friendly first-run wizard** – launch `node bot.js` once and `core/firstTime.js` will ask for the basics, write your config, seed themes, and drop `data/v0.nav` so normal boots skip the questions.
- **unified command router** – cli, whispers, and discord all route through `commands/`, keeping permissions and logging in sync.
- **truecolor terminal ui** – gradient borders, server/player telemetry, scrollable chat, keyboard/mouse interactions, and live theme switching via `.theme`.
- **role-based access control** – json whitelist with automatic legacy migration and uuid resolution.
- **persistent data** – flight state, waypoints, whitelist, and themes stored under `data/` + `config/`.
- **discord status bridge** – optional embed updates, slash commands, and arrival pings.

## requirements
- node.js 18+
- npm
- a minecraft account that can log in via the configured auth method
- (optional) discord bot token and channel id for remote control

## getting started
1. **install dependencies**
   ```bash
   npm install
   ```
2. **run the bot once**
   ```bash
   node bot.js
   ```
   - if `data/v0.nav` is missing, the first-time wizard pops up and walks you through host, account, uuid, and optional discord settings.
   - pick “launch now” at the end to jump straight into a live session, or answer “n” to exit and tweak configs by hand.
3. **manual tweaks (optional)**
   - `config/config.json` and `config/themes.json` are now created. edit them directly if you want to fine-tune flight defaults, paths, or theme presets.
4. **whitelist admins**
   - populate `data/whitelist.json` or run `.whitelist add <player>` after the bot is online.

## configuration
- `config/config.json` (ignored by git): runtime credentials, minecraft/discord settings, flight/safety defaults, log directory. it is created either by the wizard or by copying `config/config.example.json`.
- `config/themes.json`: active cli theme + palette presets. the wizard seeds it from `config/themes.example.json`; use `.theme list` / `.theme set <name>` to swap without editing the file.
- `data/` folder: whitelist, waypoints, bot state, and other persisted runtime artifacts. `data/v0.nav` is just the wizard sentinel.

## cli
- press `tab` to cycle focus across chat / status / server panels.
- `pgup/pgdn` or mouse scroll to navigate history.
- input panel displays a block cursor; type `.help` for commands.
- the `.theme` command lists presets or switches the active palette. all command surfaces (cli, whispers, discord) share the same router and rbac rules.

## discord
- optional; requires `config.discord.token` and `config.discord.channelId`.
- registers slash commands inside the configured guild for flight, waypoints, tpa, and help.
- posts live status embeds and arrival notifications when `statusMessageId` is set (auto-created if blank).

## structure
```
cli/             # terminal ui components
commands/        # shared command handlers
core/createBot   # mineflayer wiring & module orchestration
data/            # runtime state (whitelist, waypoints, etc.)
lib/             # shared utilities (config, router, logger, themes, status panel...)
modules/         # mineflayer modules (elytra, tpa, discord, commander, access control)
config/          # user-controlled configuration (ignored by git)
```

## logging
- session logs live under `logs/` (ignored by git).
- sensitive files (config, themes, data snapshots) are excluded via `.gitignore`; commit the `*.example.json` templates instead.
- before publishing to github, ensure `config/config.json` and other secret-bearing files stay untracked.

## contributing / customizing
- add commands by dropping `.js` files into `commands/` (export `{ name, handler, ... }`).
- extend the cli by editing `cli/panels/*` and `cli/index.js`.
- theme presets live in `config/themes.json`; use the example file as a scaffold for additional palettes.

feel free to open issues or prs!
