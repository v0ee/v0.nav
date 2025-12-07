function createStatusPanel({ options, updateUiStatus, updateServerInfo }) {
    if (!options) throw new Error('statusPanel requires options');
    if (typeof updateUiStatus !== 'function' || typeof updateServerInfo !== 'function') {
        throw new Error('statusPanel requires updateUiStatus and updateServerInfo handlers');
    }

    function refresh({ bot, elytraFly, autoTunnel, connectedAt }) {
        const lines = [];
        const connected = bot && bot.entity ? 'Yes' : 'No';
        const dim = bot && bot.game && bot.game.dimension ? bot.game.dimension.replace('minecraft:', '') : 'N/A';
        lines.push(`Connected: ${connected}`);
        lines.push(`Dimension: ${dim}`);

        if (bot && typeof bot.health === 'number') {
            lines.push(`Health: ${bot.health.toFixed(1)}`);
        } else {
            lines.push('Health: N/A');
        }

        const entity = bot && bot.entity ? bot.entity : null;
        if (entity) {
            lines.push(`Coords: ${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}, ${entity.position.z.toFixed(1)}`);
            const hspd = entity.velocity ? Math.sqrt((entity.velocity.x || 0) ** 2 + (entity.velocity.z || 0) ** 2) * 20 : 0;
            lines.push(`Speed: ${hspd.toFixed(1)} b/s`);
        } else {
            lines.push('Coords: N/A');
            lines.push('Speed: N/A');
        }

        lines.push('');

        const activeState = getActiveModuleState({ elytraFly, autoTunnel, entity });
        lines.push(...activeState);

        const hostLabel = options.port && options.port !== 25565 ? `${options.host}:${options.port}` : options.host;
        const uptimeMs = connectedAt ? Date.now() - connectedAt : 0;
        updateServerInfo({
            host: hostLabel,
            onlineTimeMs: uptimeMs,
            players: getOnlinePlayers(bot),
            botUsername: options.username
        });

        updateUiStatus(lines);
    }

    return { refresh };
}

function getActiveModuleState({ elytraFly, autoTunnel, entity }) {
    const lines = [];

    if (elytraFly && elytraFly.active) {
        lines.push('[ElytraFly]');
        if (elytraFly.target) {
            lines.push(`  Target: ${elytraFly.target.x}, ${elytraFly.target.z}`);
            if (elytraFly.currentWaypointName) {
                lines.push(`  Waypoint: ${elytraFly.currentWaypointName}`);
            }
            if (entity) {
                const dx = entity.position.x - elytraFly.target.x;
                const dz = entity.position.z - elytraFly.target.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                lines.push(`  ETA: ${computeEta(dist, entity.velocity)}`);
            }
        } else if (elytraFly.hoverAltitude !== null && elytraFly.hoverAltitude !== undefined) {
            lines.push(`  Hovering at Y: ${elytraFly.hoverAltitude.toFixed(1)}`);
        }
        return lines;
    }

    if (autoTunnel) {
        const status = autoTunnel.getStatus();
        if (status.status !== 'inactive') {
            lines.push('[AutoTunnel]');
            if (status.status === 'setup') {
                lines.push(`  Setting up...`);
                lines.push(`  Pos1: ${status.pos1}`);
                lines.push(`  Pos2: ${status.pos2}`);
            } else if (status.status === 'mining' || status.status === 'paused') {
                lines.push(`  ${status.status === 'paused' ? 'Paused' : 'Mining'}`);
                lines.push(`  Axis: ${status.axis.toUpperCase()} ${status.direction}`);
                lines.push(`  Depth: ${status.currentDepth}/${status.limit === Infinity ? '∞' : status.limit}`);
                lines.push(`  Mined: ${status.mined} blocks`);
            }
            return lines;
        }
    }

    lines.push('State: Idle');
    return lines;
}

function getOnlinePlayers(bot) {
    if (!bot || !bot.players) return [];
    return Object.values(bot.players)
        .map(entry => entry && entry.username)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function computeEta(distance, velocity) {
    if (!velocity) return 'N/A';
    const hspd = Math.sqrt((velocity.x || 0) ** 2 + (velocity.z || 0) ** 2);
    if (hspd <= 0.001) return 'N/A';
    const seconds = distance / (hspd * 20);
    if (!isFinite(seconds) || seconds < 0) return 'N/A';
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds)}s`;
}

module.exports = {
    createStatusPanel,
    getOnlinePlayers,
    computeEta
};
