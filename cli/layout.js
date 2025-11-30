const { clamp } = require('./screenbuffer');

const CHAT_SCROLL_JUMP = 8;
const INPUT_BOX_HEIGHT = 3;
const MIN_CHAT_HEIGHT = 10;
const MIN_PANEL_WIDTH = 30;

function computeLayout(width, height) {
    const totalWidth = Math.max(2, width);
    const totalHeight = Math.max(2, height);

    let bodyHeight = Math.max(MIN_CHAT_HEIGHT, totalHeight - INPUT_BOX_HEIGHT);
    if (bodyHeight > totalHeight - 1) {
        bodyHeight = Math.max(1, totalHeight - 1);
    }
    let inputHeight = totalHeight - bodyHeight;
    if (inputHeight < 1) {
        inputHeight = 1;
        bodyHeight = Math.max(1, totalHeight - inputHeight);
    }

    const gap = totalWidth >= (MIN_PANEL_WIDTH * 2 + 1) ? 1 : 0;
    const usableWidth = Math.max(2, totalWidth - gap);

    let chatWidth = Math.floor(usableWidth * 0.65);
    chatWidth = clamp(chatWidth, 1, usableWidth - 1);
    let statusWidth = usableWidth - chatWidth;

    const minPanel = Math.min(MIN_PANEL_WIDTH, Math.max(3, Math.floor(usableWidth / 3)));
    if (usableWidth >= minPanel * 2) {
        if (chatWidth < minPanel) {
            chatWidth = minPanel;
            statusWidth = usableWidth - chatWidth;
        }
        if (statusWidth < minPanel) {
            statusWidth = minPanel;
            chatWidth = usableWidth - statusWidth;
        }
    } else {
        if (chatWidth < 2) chatWidth = 2;
        if (statusWidth < 2) statusWidth = 2;
        let overflow = chatWidth + statusWidth - usableWidth;
        if (overflow > 0) {
            const reduceChat = Math.min(overflow, Math.max(0, chatWidth - 1));
            chatWidth -= reduceChat;
            overflow -= reduceChat;
            const reduceStatus = Math.min(overflow, Math.max(0, statusWidth - 1));
            statusWidth -= reduceStatus;
        }
    }

    if (chatWidth < 1) chatWidth = 1;
    if (statusWidth < 1) statusWidth = 1;

    const sum = chatWidth + statusWidth;
    if (sum < usableWidth) {
        statusWidth += usableWidth - sum;
    } else if (sum > usableWidth) {
        statusWidth = Math.max(1, usableWidth - chatWidth);
    }

    chatWidth = clamp(chatWidth, 1, usableWidth - 1);
    let finalChatWidth = chatWidth;
    let finalStatusWidth = usableWidth - finalChatWidth;
    if (finalStatusWidth < 1) {
        finalStatusWidth = 1;
        finalChatWidth = Math.max(1, usableWidth - finalStatusWidth);
    }

    const chatX = 1;
    const statusX = chatX + finalChatWidth + gap;
    const inputY = bodyHeight + 1;

    const verticalGap = bodyHeight >= 12 ? 1 : 0;
    let statusHeight = Math.max(6, Math.floor(bodyHeight * 0.55));
    let serverHeight = Math.max(5, bodyHeight - statusHeight - verticalGap);
    if (serverHeight < 3) {
        serverHeight = 3;
        statusHeight = Math.max(3, bodyHeight - serverHeight - verticalGap);
    }
    if (statusHeight + serverHeight + verticalGap < bodyHeight) {
        statusHeight += bodyHeight - (statusHeight + serverHeight + verticalGap);
    }
    if (statusHeight + serverHeight + verticalGap > bodyHeight) {
        serverHeight = Math.max(3, bodyHeight - statusHeight - verticalGap);
    }

    return {
        chat: {
            x: chatX,
            y: 1,
            w: finalChatWidth,
            h: bodyHeight,
            innerWidth: Math.max(0, finalChatWidth - 2),
            innerHeight: Math.max(0, bodyHeight - 2)
        },
        status: {
            x: statusX,
            y: 1,
            w: finalStatusWidth,
            h: statusHeight,
            innerWidth: Math.max(0, finalStatusWidth - 2),
            innerHeight: Math.max(0, statusHeight - 2)
        },
        server: {
            x: statusX,
            y: 1 + statusHeight + verticalGap,
            w: finalStatusWidth,
            h: Math.max(1, serverHeight),
            innerWidth: Math.max(0, finalStatusWidth - 2),
            innerHeight: Math.max(0, Math.max(1, serverHeight) - 2)
        },
        input: {
            x: 1,
            y: inputY,
            w: totalWidth,
            h: inputHeight,
            innerWidth: Math.max(0, totalWidth - 2),
            innerHeight: Math.max(0, inputHeight - 2)
        }
    };
}

function createPanelScrollState(alignBottom = false) {
    return {
        offset: 0,
        max: 0,
        viewport: 0,
        lines: [],
        alignBottom
    };
}

function preparePanelLines(state, lines, viewport, alignBottom = false) {
    const normalizedLines = Array.isArray(lines) ? lines.slice() : [];
    if (!state) {
        return alignBottom
            ? sliceVisibleLines(normalizedLines, viewport, 0)
            : sliceTopVisibleLines(normalizedLines, viewport, 0);
    }
    state.lines = normalizedLines;
    state.viewport = Math.max(0, viewport);
    state.alignBottom = !!alignBottom;
    state.max = Math.max(0, state.lines.length - state.viewport);
    state.offset = clamp(state.offset, 0, state.max);
    if (state.viewport <= 0) {
        return [];
    }
    return state.alignBottom
        ? sliceVisibleLines(state.lines, state.viewport, state.offset)
        : sliceTopVisibleLines(state.lines, state.viewport, state.offset);
}

function sliceVisibleLines(lines, visibleCount, offset) {
    if (visibleCount <= 0) return [];
    if (!Array.isArray(lines) || !lines.length) {
        return new Array(visibleCount).fill(null);
    }
    const end = Math.max(0, lines.length - offset);
    const start = Math.max(0, end - visibleCount);
    const slice = lines.slice(start, end);
    const padding = visibleCount - slice.length;
    if (padding > 0) {
        return new Array(padding).fill(null).concat(slice);
    }
    return slice;
}

function sliceTopVisibleLines(lines, visibleCount, offset) {
    if (visibleCount <= 0) return [];
    if (!Array.isArray(lines) || !lines.length) {
        return new Array(visibleCount).fill(null);
    }
    const start = clamp(offset, 0, Math.max(0, lines.length - visibleCount));
    const end = Math.min(lines.length, start + visibleCount);
    const slice = lines.slice(start, end);
    const padding = visibleCount - slice.length;
    if (padding > 0) {
        return slice.concat(new Array(padding).fill(null));
    }
    return slice;
}

function pointInRegion(x, y, region) {
    if (!region) return false;
    const withinX = x >= region.x && x <= region.x + region.w - 1;
    const withinY = y >= region.y && y <= region.y + region.h - 1;
    return withinX && withinY;
}

module.exports = {
    computeLayout,
    createPanelScrollState,
    preparePanelLines,
    pointInRegion,
    CHAT_SCROLL_JUMP,
    INPUT_BOX_HEIGHT,
    MIN_CHAT_HEIGHT,
    MIN_PANEL_WIDTH
};
