function parseChatSegments(chatMsg, parentState = defaultState()) {
    if (!chatMsg) return [];
    const sanitized = sanitizeMinecraftJson(chatMsg);
    const segments = collectSegments(sanitized, parentState);
    return flattenSegments(segments);
}

function sanitizeMinecraftJson(node) {
    if (!node || typeof node !== 'object') return node;

    if (node[''] === '<' || node[''] === '>') {
        return { text: node[''] };
    }

    if (Array.isArray(node.extra)) {
        node.extra = node.extra
            .map(sanitizeMinecraftJson)
            .filter(n => n && n.text !== undefined);
    }

    return node;
}

function collectSegments(node, parentState = defaultState()) {
    const state = deriveState(node, parentState);
    const parts = [];
    if (node.text) {
        parts.push({ text: node.text, state });
    }
    if (Array.isArray(node.extra)) {
        node.extra.forEach(child => {
            parts.push(...collectSegments(child, state));
        });
    }
    return parts;
}

function deriveState(node, parentState) {
    return {
        color: node.color !== undefined && node.color !== null ? node.color : parentState.color,
        bold: node.bold === true ? true : node.bold === false ? false : parentState.bold,
        italic: node.italic === true ? true : node.italic === false ? false : parentState.italic,
        underlined: node.underlined === true ? true : node.underlined === false ? false : parentState.underlined,
        strikethrough: node.strikethrough === true ? true : node.strikethrough === false ? false : parentState.strikethrough,
        obfuscated: node.obfuscated === true ? true : node.obfuscated === false ? false : parentState.obfuscated
    };
}

function defaultState() {
    return {
        color: null,
        bold: false,
        italic: false,
        underlined: false,
        strikethrough: false,
        obfuscated: false
    };
}

function flattenSegments(segments) {
    if (!segments.length) return [];
    const merged = [];
    segments.forEach(seg => {
        if (!seg.text) return;
        const last = merged[merged.length - 1];
        if (last && sameState(last.state, seg.state)) {
            last.text += seg.text;
        } else {
            merged.push({ text: seg.text, state: seg.state });
        }
    });
    return merged;
}

function sameState(a, b) {
    if (!a || !b) return false;
    return (
        a.color === b.color &&
        !!a.bold === !!b.bold &&
        !!a.italic === !!b.italic &&
        !!a.underlined === !!b.underlined &&
        !!a.strikethrough === !!b.strikethrough &&
        !!a.obfuscated === !!b.obfuscated
    );
}

module.exports = {
    parseChatSegments,
    sanitizeMinecraftJson,
    collectSegments,
    deriveState,
    defaultState,
    flattenSegments,
    sameState
};
