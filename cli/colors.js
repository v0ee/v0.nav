const RESET = '\u001b[0m';

const BASIC_ANSI_COLORS = {
    black: 30,
    red: 31,
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    white: 37,
    gray: 90,
    grey: 90,
    light_red: 91,
    light_green: 92,
    light_yellow: 93,
    light_blue: 94,
    light_magenta: 95,
    light_cyan: 96,
    light_white: 97
};

const DEFAULT_ATTR = {
    key: 'fg-default:bg-default:0:0:0:0',
    sequence: RESET
};

const MC_COLORS = {
    black: '#000000',
    dark_blue: '#0000AA',
    dark_green: '#00AA00',
    dark_aqua: '#00AAAA',
    dark_red: '#AA0000',
    dark_purple: '#AA00AA',
    gold: '#FFAA00',
    gray: '#AAAAAA',
    dark_gray: '#555555',
    blue: '#5555FF',
    green: '#55FF55',
    aqua: '#55FFFF',
    red: '#FF5555',
    light_purple: '#FF55FF',
    yellow: '#FFFF55',
    white: '#FFFFFF'
};

function createSegment(text, overrides = {}) {
    return {
        text,
        state: normalizeState(overrides)
    };
}

function normalizeState(state = {}) {
    return {
        color: state.color || null,
        bgColor: state.bgColor || null,
        bold: !!state.bold,
        italic: !!state.italic,
        underlined: !!state.underlined,
        strikethrough: !!state.strikethrough,
        obfuscated: !!state.obfuscated
    };
}

function ensureAttr(attr) {
    if (!attr) return DEFAULT_ATTR;
    if (attr.key && attr.sequence) return attr;
    return buildAttr(attr);
}

function buildAttr(state = {}, colorOverride, backgroundOverride) {
    const normalized = normalizeState(state);
    if (colorOverride !== undefined && colorOverride !== null) {
        normalized.color = colorOverride;
    }
    if (backgroundOverride !== undefined && backgroundOverride !== null) {
        normalized.bgColor = backgroundOverride;
    }
    const colorValue = resolveColor(normalized.color);
    const bgValue = resolveColor(normalized.bgColor);
    const key = makeAttrKey(normalized, colorValue, bgValue);
    if (key === DEFAULT_ATTR.key) {
        return DEFAULT_ATTR;
    }
    const sequence = makeAttrSequence(normalized, colorValue, bgValue);
    return {
        key,
        sequence
    };
}

function makeAttrKey(state, colorValue, bgValue) {
    return [
        colorValue || 'default',
        bgValue || 'default',
        state.bold ? '1' : '0',
        state.italic ? '1' : '0',
        state.underlined ? '1' : '0',
        state.strikethrough ? '1' : '0'
    ].join(':');
}

function makeAttrSequence(state, colorValue, bgValue) {
    const segments = [];
    if (state.bold) segments.push('1');
    if (state.italic) segments.push('3');
    if (state.underlined) segments.push('4');
    if (state.strikethrough) segments.push('9');
    if (colorValue) {
        if (colorValue.startsWith('#')) {
            const rgb = hexToRgb(colorValue);
            if (rgb) {
                segments.push(`38;2;${rgb.r};${rgb.g};${rgb.b}`);
            }
        } else {
            const ansiCode = getAnsiColorCode(colorValue);
            if (ansiCode) {
                segments.push(String(ansiCode));
            }
        }
    }
    if (bgValue) {
        if (bgValue.startsWith && bgValue.startsWith('#')) {
            const rgb = hexToRgb(bgValue);
            if (rgb) {
                segments.push(`48;2;${rgb.r};${rgb.g};${rgb.b}`);
            }
        } else {
            const ansiCode = getAnsiColorCode(bgValue);
            if (ansiCode) {
                segments.push(String(ansiCode + 10));
            }
        }
    }
    if (!segments.length) {
        return RESET;
    }
    return `\u001b[${segments.join(';')}m`;
}

function getAnsiColorCode(colorName) {
    if (!colorName) return undefined;
    if (BASIC_ANSI_COLORS[colorName]) return BASIC_ANSI_COLORS[colorName];
    if (BASIC_ANSI_COLORS[colorName.replace('-', '_')]) {
        return BASIC_ANSI_COLORS[colorName.replace('-', '_')];
    }
    return undefined;
}

function resolveColor(color) {
    const normalized = normalizeColorName(color);
    if (!normalized) return null;
    if (MC_COLORS[normalized]) return MC_COLORS[normalized];
    if (/^#[0-9a-f]{3}$/i.test(normalized)) {
        const expanded = normalized
            .replace('#', '')
            .split('')
            .map(ch => ch + ch)
            .join('');
        return `#${expanded}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
    return normalized;
}

function normalizeColorName(color) {
    if (!color || typeof color !== 'string') return undefined;
    const trimmed = color.trim().toLowerCase();
    if (!trimmed) return undefined;
    return trimmed.endsWith('-fg') ? trimmed.slice(0, -3) : trimmed;
}

function sameState(a, b) {
    if (!a || !b) return false;
    return (
        a.color === b.color &&
        a.bgColor === b.bgColor &&
        !!a.bold === !!b.bold &&
        !!a.italic === !!b.italic &&
        !!a.underlined === !!b.underlined &&
        !!a.strikethrough === !!b.strikethrough &&
        !!a.obfuscated === !!b.obfuscated
    );
}

function hexToRgb(hex) {
    const normalized = (hex || '').replace('#', '');
    if (normalized.length !== 6) return null;
    const value = parseInt(normalized, 16);
    if (Number.isNaN(value)) return null;
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff
    };
}

module.exports = {
    BASIC_ANSI_COLORS,
    DEFAULT_ATTR,
    MC_COLORS,
    createSegment,
    buildAttr,
    ensureAttr,
    resolveColor,
    normalizeColorName,
    normalizeState,
    sameState,
    hexToRgb
};
