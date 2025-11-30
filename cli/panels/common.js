const { DEFAULT_ATTR, buildAttr, ensureAttr, createSegment, normalizeState, sameState } = require('../colors');
const { takeByWidth, charWidth, clamp } = require('../screenbuffer');
const { TITLE_PADDING, DEFAULT_BORDER } = require('./themes');

function drawBox(buffer, region, options = {}, context = {}) {
    const { x, y, w, h } = region;
    const {
        border = DEFAULT_BORDER,
        title,
        titleSegments,
        subtitle,
        theme,
        isFocused = false
    } = options;
    const innerWidth = Math.max(0, w - 2);
    const innerHeight = Math.max(0, h - 2);

    if (w <= 0 || h <= 0) {
        return {
            innerX: x,
            innerY: y,
            innerWidth: 0,
            innerHeight: 0
        };
    }

    if (w < 2 || h < 2) {
        fillRegion(buffer, x, y, w, h, ' ', getThemeBodyAttr(theme));
        return {
            innerX: x,
            innerY: y,
            innerWidth: Math.max(0, w),
            innerHeight: Math.max(0, h)
        };
    }

    const drawBorderChar = (col, row, char) => {
        const attr = typeof context.borderAttr === 'function'
            ? context.borderAttr(col, row, isFocused)
            : DEFAULT_ATTR;
        buffer.put({ x: col, y: row, attr }, char);
    };

    drawBorderChar(x, y, border.tl);
    for (let col = 1; col <= w - 2; col++) {
        drawBorderChar(x + col, y, border.h);
    }
    drawBorderChar(x + w - 1, y, border.tr);

    for (let row = 1; row <= h - 2; row++) {
        drawBorderChar(x, y + row, border.v);
        drawBorderChar(x + w - 1, y + row, border.v);
    }

    drawBorderChar(x, y + h - 1, border.bl);
    for (let col = 1; col <= w - 2; col++) {
        drawBorderChar(x + col, y + h - 1, border.h);
    }
    drawBorderChar(x + w - 1, y + h - 1, border.br);

    fillRegion(buffer, x + 1, y + 1, innerWidth, innerHeight, ' ', getThemeBodyAttr(theme));

    const resolvedTitleSegments = buildTitleSegments(titleSegments, title, subtitle);
    if (resolvedTitleSegments.length && innerWidth > 0) {
        renderTitle(buffer, x + 1, y, innerWidth, resolvedTitleSegments, context);
    }

    return {
        innerX: x + 1,
        innerY: y + 1,
        innerWidth,
        innerHeight
    };
}

function renderTitle(buffer, startX, y, maxWidth, segments, context = {}) {
    if (!segments.length || maxWidth <= 0) return;
    const usableWidth = Math.max(0, maxWidth - TITLE_PADDING);
    const truncated = sliceSegmentsToWidth(segments, usableWidth);
    const totalWidth = measureSegmentsWidth(truncated);
    const offset = Math.max(0, Math.floor((usableWidth - totalWidth) / 2));
    let cursor = startX + offset;
    truncated.forEach(seg => {
        if (!seg || !seg.text) return;
        for (const char of seg.text) {
            const charW = Math.max(0, charWidth(char));
            if (charW === 0) continue;
            const attr = typeof context.titleAttr === 'function'
                ? context.titleAttr(cursor, y, seg.state || {})
                : ensureAttr(seg.state);
            buffer.put({ x: cursor, y, attr }, char);
            cursor += charW;
        }
    });
}

function measureSegmentsWidth(segments) {
    let width = 0;
    segments.forEach(seg => {
        if (!seg || !seg.text) return;
        for (const char of seg.text) {
            width += Math.max(0, charWidth(char));
        }
    });
    return width;
}

function sliceSegmentsToWidth(segments, maxWidth) {
    if (maxWidth <= 0) return [];
    const sliced = [];
    let used = 0;
    for (const seg of segments) {
        if (!seg || !seg.text) continue;
        let chunk = '';
        for (const char of seg.text) {
            const charW = Math.max(0, charWidth(char));
            if (charW === 0) continue;
            if (used + charW > maxWidth) {
                used = maxWidth;
                break;
            }
            chunk += char;
            used += charW;
        }
        if (chunk) {
            sliced.push({ text: chunk, state: seg.state || {} });
        }
        if (used >= maxWidth) break;
    }
    return sliced;
}

function drawLogLine(buffer, x, y, width, line, theme) {
    const bgAttr = getThemeBodyAttr(theme);
    if (!line) {
        clearLine(buffer, x, y, width, bgAttr);
        return;
    }
    if (line.kind === 'segments') {
        drawSegmentLine(buffer, x, y, width, line.segments, theme);
        return;
    }
    drawPlainLine(buffer, x, y, width, line.text || '', line.color, theme);
}

function drawPlainLine(buffer, x, y, width, text, color, theme) {
    const bgAttr = getThemeBodyAttr(theme);
    clearLine(buffer, x, y, width, bgAttr);
    if (!text) return;
    const textColor = color || theme?.textColor || null;
    const attr = buildAttr({ bgColor: theme?.bodyBg || null }, textColor);
    writeText(buffer, x, y, width, text, attr);
}

function drawSegmentLine(buffer, x, y, width, segments, theme) {
    const bgAttr = getThemeBodyAttr(theme);
    clearLine(buffer, x, y, width, bgAttr);
    let col = 0;
    let remaining = width;
    for (const seg of segments) {
        if (!seg || !seg.text || remaining <= 0) continue;
        const { text: chunk, width: chunkWidth } = takeByWidth(seg.text, remaining);
        if (!chunk || chunkWidth <= 0) continue;
        const state = seg.state || {};
        const attr = buildAttr({ ...state, bgColor: theme?.bodyBg || null }, state.color || theme?.textColor || null);
        writeText(buffer, x + col, y, remaining, chunk, attr);
        col += chunkWidth;
        remaining -= chunkWidth;
    }
}

function clearLine(buffer, x, y, width, attr = DEFAULT_ATTR) {
    fillRegion(buffer, x, y, width, 1, ' ', attr);
}

function fillRegion(buffer, x, y, w, h, char = ' ', attr = DEFAULT_ATTR) {
    if (w <= 0 || h <= 0) return;
    const maxX = buffer.width;
    const maxY = buffer.height;
    const startX = clamp(x, 1, maxX);
    const startY = clamp(y, 1, maxY);
    const endX = clamp(x + w - 1, 1, maxX);
    const endY = clamp(y + h - 1, 1, maxY);
    if (startX > endX || startY > endY) return;
    const normalizedAttr = ensureAttr(attr);
    for (let row = startY; row <= endY; row++) {
        buffer.fill({ attr: normalizedAttr, char, x: startX, y: row, width: endX - startX + 1, height: 1 });
    }
}

function writeText(buffer, x, y, width, text, attr) {
    if (width <= 0) return;
    const source = String(text ?? '');
    if (!source) return;
    const maxX = buffer.width;
    const maxY = buffer.height;
    if (y < 1 || y > maxY) return;
    const startX = clamp(x, 1, maxX);
    const availableWidth = Math.min(width, maxX - startX + 1);
    if (availableWidth <= 0) return;
    const { text: sliced } = takeByWidth(source, availableWidth);
    if (!sliced) return;
    let cursor = startX;
    for (const char of sliced) {
        const charW = Math.max(0, charWidth(char));
        if (charW === 0) continue;
        if (cursor + charW - startX > availableWidth) break;
        const attrValue = typeof attr === 'function' ? attr(cursor, y, char) : attr;
        buffer.put({ x: cursor, y, attr: ensureAttr(attrValue) }, char);
        cursor += charW;
        if (cursor >= startX + availableWidth) break;
    }
}

function wrapText(text, width) {
    if (width <= 0) return [''];
    const lines = [];
    const source = String(text ?? '').replace(/\r/g, '').split('\n');
    source.forEach(chunk => {
        if (chunk.length === 0) {
            lines.push('');
            return;
        }
        let current = '';
        let currentWidth = 0;
        for (const char of chunk) {
            const charW = Math.max(0, charWidth(char));
            if (charW > width) continue;
            if (charW > 0 && currentWidth + charW > width) {
                lines.push(current);
                current = char;
                currentWidth = charW;
            } else {
                current += char;
                currentWidth += charW;
            }
        }
        lines.push(current);
    });
    if (!lines.length) {
        lines.push('');
    }
    return lines;
}

function wrapSegments(segments, width) {
    if (!Array.isArray(segments) || width <= 0) return [[{ text: '', state: {} }]];
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    const pushLine = () => {
        lines.push(currentLine.length ? currentLine : [{ text: '', state: {} }]);
        currentLine = [];
        currentWidth = 0;
    };

    const appendChar = (char, state) => {
        const charW = Math.max(0, charWidth(char));
        if (charW > width) return;
        if (charW > 0 && currentWidth + charW > width) {
            pushLine();
        }
        const last = currentLine[currentLine.length - 1];
        if (last && sameState(last.state, state)) {
            last.text += char;
        } else {
            currentLine.push({ text: char, state });
        }
        if (charW > 0) {
            currentWidth += charW;
        }
    };

    segments.forEach(seg => {
        if (!seg || typeof seg.text !== 'string') return;
        const pieces = seg.text.replace(/\r/g, '').split('\n');
        const normalizedState = normalizeState(seg.state);
        pieces.forEach((piece, idx) => {
            if (piece.length) {
                for (const char of piece) {
                    appendChar(char, normalizedState);
                }
            }
            if (idx < pieces.length - 1) {
                pushLine();
            }
        });
    });

    if (currentLine.length || !lines.length) {
        pushLine();
    }
    return lines;
}

function buildTitleSegments(customSegments, fallbackTitle, subtitle) {
    const segments = [];
    if (Array.isArray(customSegments) && customSegments.length) {
        customSegments.forEach(seg => {
            if (!seg || typeof seg.text !== 'string') return;
            segments.push(createSegment(seg.text, seg.state || {}));
        });
    } else if (fallbackTitle) {
        segments.push(createSegment(` ${fallbackTitle} `, { bold: true }));
    }
    if (subtitle) {
        segments.push(createSegment(` ${subtitle}`, { color: '#bbbbbb' }));
    }
    return segments;
}

function getThemeBodyAttr(theme) {
    if (!theme || !theme.bodyBg) return DEFAULT_ATTR;
    return buildAttr({ bgColor: theme.bodyBg });
}

module.exports = {
    drawBox,
    drawLogLine,
    drawPlainLine,
    drawSegmentLine,
    clearLine,
    fillRegion,
    wrapText,
    wrapSegments,
    buildTitleSegments,
    getThemeBodyAttr
};
