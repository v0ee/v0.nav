const { drawBox, drawPlainLine, wrapText } = require('./common');

const CURSOR_CHAR = '\u2588';

function renderInputPanel(buffer, region, inputBuffer = '', context, theme, options = {}) {
    const activeTheme = theme || {};
    const box = drawBox(buffer, region, { theme: activeTheme, title: activeTheme.title }, context);
    if (box.innerHeight <= 0 || box.innerWidth <= 0) return;
    const prompt = `> ${inputBuffer}`;
    const promptLines = wrapText(prompt, box.innerWidth);
    let display = promptLines.length ? promptLines[promptLines.length - 1] : '';
    if (options.showCursor !== false && box.innerWidth > 0) {
        if (display.length >= box.innerWidth) {
            display = display.slice(0, Math.max(0, box.innerWidth - 1));
        }
        display += CURSOR_CHAR;
    }
    drawPlainLine(buffer, box.innerX, box.innerY, box.innerWidth, display, null, activeTheme);
    if (box.innerHeight > 1) {
        drawPlainLine(
            buffer,
            box.innerX,
            box.innerY + 1,
            box.innerWidth,
            'Enter: send  •  Ctrl+C: exit',
            null,
            activeTheme
        );
    }
}

module.exports = {
    renderInputPanel
};
