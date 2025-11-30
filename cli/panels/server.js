const { drawBox, drawSegmentLine, drawPlainLine, clearLine, getThemeBodyAttr } = require('./common');

function renderServerPanel(buffer, region, lines = [], isFocused, context, theme) {
    const activeTheme = theme || {};
    const box = drawBox(buffer, region, { theme: activeTheme, title: activeTheme.title, isFocused }, context);
    if (box.innerHeight <= 0 || box.innerWidth <= 0) return;
    for (let i = 0; i < box.innerHeight; i++) {
        const entry = lines[i];
        const y = box.innerY + i;
        if (!entry) {
            clearLine(buffer, box.innerX, y, box.innerWidth, getThemeBodyAttr(activeTheme));
            continue;
        }
        if (entry.kind === 'segments') {
            drawSegmentLine(buffer, box.innerX, y, box.innerWidth, entry.segments, activeTheme);
        } else {
            drawPlainLine(buffer, box.innerX, y, box.innerWidth, entry.text || '', null, activeTheme);
        }
    }
}

module.exports = {
    renderServerPanel
};
