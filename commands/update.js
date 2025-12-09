const updateManager = require('../lib/updateManager');
const path = require('path');

module.exports = {
    name: 'update',
    description: 'Pull the latest version from the GitHub repository',
    usage: '.update',
    cliOnly: true,
    handler: async ({ respond = () => {} }) => {
        try {
            const result = await updateManager.applyUpdates({ repoPath: path.resolve(__dirname, '..') });
            if (result.updated) {
                respond(`Updated to latest ${result.status.branch} (${result.status.localHash}). Please restart FlightBot to apply changes.`, 'green');
            } else {
                respond('Already up to date.', 'cyan');
            }
        } catch (err) {
            respond(`Update failed: ${err.message}`, 'red');
        }
    }
};
