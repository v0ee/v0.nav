module.exports = {
    name: 'status',
    description: 'Refresh status panel',
    usage: '.status',
    handler: ({ respond = () => {}, refreshStatus }) => {
        refreshStatus?.();
        respond('Status panel refreshed.');
    }
};
