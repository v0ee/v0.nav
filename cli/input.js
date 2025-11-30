const readline = require('readline');
const { PassThrough } = require('stream');
const stdin = process.stdin;
const stdout = process.stdout;

const ESC = '\u001b[';
const MOUSE_SEQUENCE_FULL = /^\u001b\[<(\d+);(\d+);(\d+)([mM])$/;
const MOUSE_SEQUENCE_GLOBAL = /\u001b\[<\d+;\d+;\d+[mM]/g;
const MOUSE_SEQUENCE_PREFIX = '\u001b[<';

let inputStream = null;
let pendingMouseData = '';
let mouseTrackingEnabled = false;
let dataListener = null;
let keypressListener = null;
let currentHandlers = {
    onKeypress: null,
    onMouseSequence: null
};

function initInputHandlers(handlers = {}) {
    currentHandlers = {
        onKeypress: handlers.onKeypress || null,
        onMouseSequence: handlers.onMouseSequence || null
    };
    ensureInputStream();
    if (!dataListener) {
        dataListener = chunk => handleRawInputData(chunk);
        stdin.on('data', dataListener);
    }
}

function cleanupInputHandlers() {
    if (dataListener) {
        stdin.removeListener('data', dataListener);
        dataListener = null;
    }
    if (inputStream && keypressListener) {
        inputStream.removeListener('keypress', keypressListener);
        keypressListener = null;
    }
    if (inputStream) {
        inputStream.end();
        inputStream = null;
    }
    pendingMouseData = '';
}

function ensureInputStream() {
    if (inputStream) {
        updateKeypressListener();
        return;
    }
    inputStream = new PassThrough();
    inputStream.setEncoding('utf8');
    readline.emitKeypressEvents(inputStream);
    updateKeypressListener();
}

function updateKeypressListener() {
    if (!inputStream) return;
    if (keypressListener) {
        inputStream.removeListener('keypress', keypressListener);
    }
    keypressListener = (str, key) => {
        if (typeof currentHandlers.onKeypress === 'function') {
            currentHandlers.onKeypress(str, key);
        }
    };
    inputStream.on('keypress', keypressListener);
}

function handleRawInputData(chunk) {
    if (!chunk) return;
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (!data) return;
    ensureInputStream();
    pendingMouseData += data;
    MOUSE_SEQUENCE_GLOBAL.lastIndex = 0;
    let cursor = 0;
    let match;
    while ((match = MOUSE_SEQUENCE_GLOBAL.exec(pendingMouseData)) !== null) {
        const index = match.index;
        if (index > cursor) {
            forwardInputSegment(pendingMouseData.slice(cursor, index));
        }
        handleMouseSequence(match[0]);
        cursor = index + match[0].length;
    }

    let remainder = pendingMouseData.slice(cursor);
    if (remainder) {
        const suffixLen = longestMousePrefixSuffix(remainder);
        if (suffixLen > 0) {
            const safePortion = remainder.slice(0, remainder.length - suffixLen);
            if (safePortion) {
                forwardInputSegment(safePortion);
            }
            remainder = remainder.slice(-suffixLen);
        } else {
            forwardInputSegment(remainder);
            remainder = '';
        }
    }
    pendingMouseData = remainder ? remainder.slice(-50) : '';
}

function handleMouseSequence(sequence) {
    if (typeof currentHandlers.onMouseSequence === 'function') {
        currentHandlers.onMouseSequence(sequence, parseMouseSequence(sequence));
    }
    return true;
}

function parseMouseSequence(sequence) {
    const match = MOUSE_SEQUENCE_FULL.exec(sequence || '');
    if (!match) return null;
    return {
        code: Number(match[1]),
        x: Number(match[2]),
        y: Number(match[3]),
        final: match[4]
    };
}

function longestMousePrefixSuffix(buffer) {
    const maxLen = Math.min(MOUSE_SEQUENCE_PREFIX.length - 1, buffer.length);
    for (let len = maxLen; len > 0; len--) {
        const suffix = buffer.slice(-len);
        if (MOUSE_SEQUENCE_PREFIX.startsWith(suffix)) {
            return len;
        }
    }
    return 0;
}

function forwardInputSegment(text) {
    if (!inputStream || !text) return;
    if (typeof text !== 'string') {
        text = String(text ?? '');
    }
    if (!text) return;
    inputStream.write(text);
}

function enableMouseTracking() {
    if (mouseTrackingEnabled || !stdout.isTTY) return;
    stdout.write(`${ESC}?1000h${ESC}?1002h${ESC}?1006h`);
    mouseTrackingEnabled = true;
}

function disableMouseTracking() {
    if (!mouseTrackingEnabled || !stdout.isTTY) return;
    stdout.write(`${ESC}?1000l${ESC}?1002l${ESC}?1006l`);
    mouseTrackingEnabled = false;
}

module.exports = {
    initInputHandlers,
    cleanupInputHandlers,
    enableMouseTracking,
    disableMouseTracking
};
