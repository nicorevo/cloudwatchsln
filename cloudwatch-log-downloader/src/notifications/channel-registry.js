const { SlackChannel } = require('./slack-channel');

function createChannels(channelConfigs, logger, options = {}) {
    return (channelConfigs || [])
        .filter(channel => channel.enabled !== false)
        .map(channel => {
            if (channel.type === 'slack') {
                return new SlackChannel(channel, logger, {
                    ...options.slack,
                    webhookUrl: process.env[channel.webhookUrlEnv]
                });
            }
            throw new Error(`Tipo channel non supportato: ${channel.type}`);
        });
}

module.exports = {
    createChannels
};
