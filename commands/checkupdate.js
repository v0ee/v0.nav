const updateManager = require('../lib/updateManager');
const path = require('path');

module.exports = {
    name: 'checkupdate',
    description: 'Check if a newer version of v0.nav is available',
    usage: '.checkupdate',
    cliOnly: true,
    handler: async ({ respond = () => {} }) => {
        try {
            const info = await updateManager.checkForUpdates({ repoPath: path.resolve(__dirname, '..') });
            respond(formatStatus(info));
        } catch (err) {
            respond(`Update check failed: ${err.message}`, 'red');
        }
    }
};

function formatStatus(info) {
    if (!info) return 'Unable to determine update status.';
    const base = `Branch ${info.branch} (${info.localHash || 'unknown'})`;
    const customMessage = formatCustomWarning(info);
    switch (info.status) {
        case 'behind':
            return `${base} is ${info.behind} commit(s) behind ${info.remoteRef}. Run .update to install.${customMessage}`;
        case 'ahead':
            return `${base} has ${info.ahead} local commit(s) not pushed. Updates not pulled.${customMessage}`;
        case 'diverged':
            return `${base} has diverged from ${info.remoteRef}. Please sync manually.${customMessage}`;
        case 'no-remote':
            return `${base} has no upstream remote configured.${customMessage}`;
        default:
            return `${base} is up to date.${customMessage}`;
    }
}

function formatCustomWarning(info) {
    if (!info?.hasCustomCode) return '';
    const details = info.customCodeDetails || {};
    const files = [...new Set([...(details.workingTree || []), ...(details.committed || [])])];
    let filePreview = '';
    if (files.length > 0) {
        const preview = files.slice(0, 3).join(', ');
        const extra = files.length > 3 ? ` (+${files.length - 3} more)` : '';
        filePreview = ` Changed files: ${preview}${extra}.`;
    }
    return ` Warning: you're running a custom build of v0.nav. Support is not guaranteed.${filePreview}`;
}
