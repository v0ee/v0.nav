const { drawBox, drawLogLine } = require('./common');

function renderChatPanel(buffer, region, visibleLogs = [], isFocused, context, theme) {
    const activeTheme = theme || {};
    const box = drawBox(buffer, region, {
        theme: activeTheme,
        titleSegments: activeTheme.titleSegments,
        subtitle: activeTheme.subtitle,
        isFocused
    }, context);
    if (box.innerHeight <= 0 || box.innerWidth <= 0) return;
    for (let i = 0; i < box.innerHeight; i++) {
        const line = visibleLogs[i] || null;
        drawLogLine(buffer, box.innerX, box.innerY + i, box.innerWidth, line, activeTheme);
    }
}

module.exports = {
    renderChatPanel
};
