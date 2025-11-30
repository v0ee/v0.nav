const { drawBox, drawPlainLine } = require('./common');

function renderStatusPanel(buffer, region, visibleLines = [], isFocused, context, theme) {
    const activeTheme = theme || {};
    const box = drawBox(buffer, region, { theme: activeTheme, title: activeTheme.title, isFocused }, context);
    if (box.innerHeight <= 0 || box.innerWidth <= 0) return;
    for (let i = 0; i < box.innerHeight; i++) {
        const entry = visibleLines[i];
        const text = typeof entry === 'string' ? entry : entry?.text || '';
        drawPlainLine(buffer, box.innerX, box.innerY + i, box.innerWidth, text, null, activeTheme);
    }
}

module.exports = {
    renderStatusPanel
};
