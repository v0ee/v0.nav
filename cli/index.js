const stdout = process.stdout;
const stdin = process.stdin;

const ESC = '\u001b[';
const RESET = '\u001b[0m';
const CLEAR_SCREEN = '\u001b[2J';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
const MAX_RAINBOW_PHASE = 6000;
const GRADIENT_PERIOD_MS = 8000;
const ANIMATION_TICK_MS = 300;
const LOG_LIMIT = 400;
const INPUT_CURSOR_CHAR = '\u2588';

const {
    ScreenBuffer,
    cursorTo,
    clamp,
    charWidth
} = require('./screenbuffer');
const {
    computeLayout,
    createPanelScrollState,
    preparePanelLines,
    pointInRegion,
    CHAT_SCROLL_JUMP
} = require('./layout');
const {
    initInputHandlers,
    cleanupInputHandlers,
    enableMouseTracking,
    disableMouseTracking
} = require('./input');
const { getPanelThemes, setPanelThemesFromConfig } = require('./panels/themes');
const { renderChatPanel } = require('./panels/chat');
const { renderStatusPanel } = require('./panels/status');
const { renderServerPanel } = require('./panels/server');
const { renderInputPanel } = require('./panels/input');
const { wrapText, wrapSegments } = require('./panels/common');
const { createInstanceModal } = require('./panels/instanceModal');
const {
    createSegment,
    buildAttr
} = require('./colors');

const FOCUSABLE_PANELS = ['chat', 'status', 'server'];

const logEntries = [];
const pendingLogs = [];
let statusLines = ['Waiting for bot...'];
let inputBuffer = '';
let uiReady = false;
let instanceModal = null;
let renderScheduled = false;
let terminalInitialized = false;
let terminalCleanedUp = false;
let terminalInitStarted = false;
let logCounter = 0;
let focusedPanel = 'chat';
const panelScroll = {
    chat: createPanelScrollState(true),
    status: createPanelScrollState(false),
    server: createPanelScrollState(false)
};
let lastLayout = null;
let screenBuffer = null;
let bufferWidth = 0;
let bufferHeight = 0;
let serverInfo = {
    host: 'N/A',
    onlineTimeMs: 0,
    players: [],
    botUsername: ''
};
let animationTimer = null;
let animationStart = Date.now();
let detachThemeListener = null;
let themeCleanupRegistered = false;

let currentHandlers = {
    onSubmit: async () => {},
    onCtrlC: () => process.exit(0),
    onInstanceSwitch: null
};
let originalConsoleLog = console.log;
let originalConsoleError = console.error;

async function initCli(options = {}) {
    currentHandlers = {
        onSubmit: typeof options.onSubmit === 'function' ? options.onSubmit : async () => {},
        onCtrlC: typeof options.onCtrlC === 'function' ? options.onCtrlC : () => process.exit(0),
        onInstanceStart: typeof options.onInstanceStart === 'function' ? options.onInstanceStart : null,
        onInstanceStop: typeof options.onInstanceStop === 'function' ? options.onInstanceStop : null,
        onSetActiveInstance: typeof options.onSetActiveInstance === 'function' ? options.onSetActiveInstance : null
    };

    if (options.instanceManager && options.multiBotManager) {
        instanceModal = createInstanceModal({
            instanceManager: options.instanceManager,
            multiBotManager: options.multiBotManager,
            onStart: (instance) => {
                if (currentHandlers.onInstanceStart) {
                    currentHandlers.onInstanceStart(instance);
                }
            },
            onStop: (instanceId) => {
                if (currentHandlers.onInstanceStop) {
                    currentHandlers.onInstanceStop(instanceId);
                }
            },
            onSetActive: (instanceId) => {
                if (currentHandlers.onSetActiveInstance) {
                    currentHandlers.onSetActiveInstance(instanceId);
                }
                forwardSystemLog(`Set active instance: ${instanceId}`, 'cyan');
            },
            onClose: () => scheduleRender(),
            onAddNew: (instance) => {
                forwardSystemLog(`Created new instance: ${instance.name}`, 'green');
            }
        });
        
        options.multiBotManager.on('activeChanged', ({ instanceId, chatLogs }) => {
            if (chatLogs && Array.isArray(chatLogs)) {
                logEntries.length = 0;
                chatLogs.forEach(entry => {
                    if (entry) {
                        logEntries.push(entry);
                    }
                });
                panelScroll.chat.offset = 0;
                scheduleRender();
            }
            const entry = options.multiBotManager.getActiveEntry();
            forwardSystemLog(`Switched to instance: ${entry?.instance?.name || instanceId}`, 'green');
        });
        
        forwardSystemLog('Instance modal initialized. Press F2 to open.', 'cyan');
    } else if (options.instanceManager) {
        forwardSystemLog('MultiBotManager not provided - instance modal disabled.', 'yellow');
    }

    configureThemeManager(options.themeManager);

    setupTerminal();
    uiReady = true;

    if (pendingLogs.length) {
        const queued = pendingLogs.splice(0, pendingLogs.length);
        queued.forEach(entry => appendLog(entry, false));
    }

    scheduleRender();
}

function setConsoleHandlers(logFn, errorFn) {
    if (typeof logFn === 'function') {
        originalConsoleLog = logFn;
    }
    if (typeof errorFn === 'function') {
        originalConsoleError = errorFn;
    }
}

function logChatMessage(payload, color) {
    if (!payload) return;
    let segments = payload;
    if (typeof payload === 'string') {
        segments = [createSegment(payload, { color })];
    }
    if (!Array.isArray(segments) || !segments.length) return;
    queueLog({ type: 'segments', segments });
}

function forwardSystemLog(message, color = 'cyan') {
    queueLog({ type: 'system', text: message, color });
}

function queueLog(entry) {
    entry.id = ++logCounter;
    if (!uiReady) {
        pendingLogs.push(entry);
        if (entry.type === 'system') {
            originalConsoleLog(`[SYS] ${entry.text}`);
        }
        return;
    }
    appendLog(entry, true);
}

function updateUiStatus(lines) {
    statusLines = Array.isArray(lines) ? lines.slice() : [];
    scheduleRender();
}

function updateServerInfo(info = {}) {
    const next = { ...serverInfo };
    if (typeof info.host === 'string') {
        next.host = info.host;
    }
    if (typeof info.onlineTimeMs === 'number' && Number.isFinite(info.onlineTimeMs) && info.onlineTimeMs >= 0) {
        next.onlineTimeMs = info.onlineTimeMs;
    }
    if (Array.isArray(info.players)) {
        next.players = info.players.slice(0, 200);
    }
    if (typeof info.botUsername === 'string') {
        next.botUsername = info.botUsername;
    }
    serverInfo = next;
    scheduleRender();
}

function appendLog(entry, requestRender) {
    logEntries.push(entry);
    if (logEntries.length > LOG_LIMIT) {
        logEntries.shift();
    }
    const chatState = panelScroll.chat;
    const atBottom = !chatState || chatState.offset === 0;
    if (requestRender) {
        scheduleRender();
    }
    if (atBottom && chatState) {
        chatState.offset = 0;
    }
}

function scheduleRender() {
    if (!uiReady || !terminalInitialized || renderScheduled) return;
    renderScheduled = true;
    setImmediate(() => {
        renderScheduled = false;
        renderUi();
    });
}

function setupTerminal() {
    if (terminalInitStarted || terminalInitialized) return;
    if (!isInteractiveTerminal()) {
        originalConsoleLog('CLI requires an interactive terminal. Skipping UI init.');
        return;
    }
    terminalInitStarted = true;
    if (typeof stdin.setEncoding === 'function') {
        stdin.setEncoding('utf8');
    }
    if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(true);
    }
    stdin.resume();
    initInputHandlers({
        onKeypress: handleKeypress,
        onMouseSequence: handleMouseSequence
    });
    stdout.on('resize', handleResize);
    process.once('exit', cleanupTerminal);
    stdout.write(HIDE_CURSOR + CLEAR_SCREEN + cursorTo(1, 1));
    enableMouseTracking();
    terminalInitialized = true;
    terminalCleanedUp = false;
    terminalInitStarted = false;
    animationStart = Date.now();
    if (!animationTimer) {
        animationTimer = setInterval(() => {
            if (!terminalInitialized) {
                clearInterval(animationTimer);
                animationTimer = null;
                return;
            }
            scheduleRender();
        }, ANIMATION_TICK_MS);
    }
    scheduleRender();
}

function cleanupTerminal() {
    if (terminalCleanedUp) return;
    terminalCleanedUp = true;
    cleanupInputHandlers();
    if (stdin && typeof stdin.setRawMode === 'function') {
        try {
            stdin.setRawMode(false);
        } catch (_) {
            /* noop */
        }
    }
    if (stdin) {
        stdin.pause();
    }
    if (stdout) {
        stdout.removeListener('resize', handleResize);
        if (stdout.isTTY) {
            disableMouseTracking();
            stdout.write(SHOW_CURSOR + RESET + CLEAR_SCREEN + cursorTo(1, 1));
        }
    }
    if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
    }
    terminalInitialized = false;
    terminalInitStarted = false;
    screenBuffer = null;
    bufferWidth = 0;
    bufferHeight = 0;
}

function handleResize() {
    scheduleRender();
}

function handleKeypress(str, key = {}) {
    if (!key) key = {};
    const isCtrlC = key.sequence === '\u0003' || (key.ctrl && key.name === 'c');
    if (isCtrlC) {
        cleanupTerminal();
        safeInvoke(currentHandlers.onCtrlC);
        return;
    }

    const isCtrlI = (key.ctrl && key.name === 'i') || 
                    (key.ctrl && str === '\t') ||
                    key.name === 'f2';
    if (isCtrlI && instanceModal) {
        instanceModal.toggle();
        scheduleRender();
        return;
    }

    if (instanceModal && instanceModal.isVisible()) {
        const handled = instanceModal.handleKeypress(str, key);
        if (handled) {
            scheduleRender();
            return;
        }
    }

    switch (key.name) {
        case 'up':
            adjustScroll(1);
            return;
        case 'down':
            adjustScroll(-1);
            return;
        case 'pageup':
            adjustScroll(CHAT_SCROLL_JUMP);
            return;
        case 'pagedown':
            adjustScroll(-CHAT_SCROLL_JUMP);
            return;
        case 'tab':
            cyclePanelFocus(!!key.shift);
            return;
        case 'return':
        case 'enter':
            submitInput();
            return;
        case 'backspace':
        case 'delete':
            if (inputBuffer.length) {
                inputBuffer = inputBuffer.slice(0, -1);
                scheduleRender();
            }
            return;
        default:
            break;
    }

    if (str && !key.ctrl && !key.meta) {
        inputBuffer += str;
        scheduleRender();
    }
}

function handleMouseSequence(_sequence, parsed) {
    const match = parsed;
    if (!match) return false;
    const { code, x, y, final } = match;
    if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return true;
    }
    const isRelease = final === 'm';
    if (code >= 64) {
        if (!isRelease) {
            const panel = panelFromCoordinates(x, y);
            const delta = code === 64 ? 3 : code === 65 ? -3 : 0;
            if (panel && delta) {
                scrollPanel(panel, delta);
            }
        }
        return true;
    }
    const isDrag = (code & 32) === 32;
    if (!isRelease && !isDrag) {
        const button = code & 3;
        if (button === 0 || button === 1 || button === 2) {
            const panel = panelFromCoordinates(x, y);
            if (panel) {
                focusPanel(panel);
            }
        }
    }
    return true;
}

function adjustScroll(delta) {
    if (!delta) return;
    scrollPanel(focusedPanel, delta);
}

function cyclePanelFocus(reverse = false) {
    const order = FOCUSABLE_PANELS;
    if (!order.length) return;
    const current = Math.max(0, order.indexOf(focusedPanel));
    const nextIndex = reverse ? current - 1 : current + 1;
    const wrappedIndex = (nextIndex + order.length) % order.length;
    focusPanel(order[wrappedIndex]);
}

function focusPanel(panelKey) {
    if (!panelScroll[panelKey]) return;
    if (focusedPanel === panelKey) return;
    focusedPanel = panelKey;
    scheduleRender();
}

function scrollPanel(panelKey, delta) {
    const state = panelScroll[panelKey];
    if (!state || !delta || state.viewport <= 0) return;
    const direction = state.alignBottom ? 1 : -1;
    const nextOffset = clamp(state.offset + delta * direction, 0, state.max);
    if (nextOffset === state.offset) return;
    state.offset = nextOffset;
    scheduleRender();
}

function submitInput() {
    const raw = inputBuffer;
    inputBuffer = '';
    scheduleRender();
    const trimmed = (raw || '').trim();
    if (!trimmed) return;
    safeInvoke(currentHandlers.onSubmit, trimmed);
}

function safeInvoke(fn, arg) {
    if (typeof fn !== 'function') return;
    try {
        const result = fn(arg);
        if (result && typeof result.then === 'function') {
            result.catch(err => originalConsoleError('CLI handler error:', err));
        }
    } catch (err) {
        originalConsoleError('CLI handler error:', err);
    }
}

function renderUi() {
    if (!terminalInitialized || !isInteractiveTerminal()) return;

    const width = Math.max(2, stdout.columns || bufferWidth || 80);
    const height = Math.max(2, stdout.rows || bufferHeight || 24);
    const layout = computeLayout(width, height);
    lastLayout = layout;
    const panelThemes = getPanelThemes();

    const chatViewport = Math.max(1, layout.chat.innerHeight);
    const logLines = computeLogLines(layout.chat.innerWidth);
    const visibleLogs = preparePanelLines(panelScroll.chat, logLines, chatViewport, true);

    const statusLinesWrapped = buildStatusLines(layout.status.innerWidth);
    const visibleStatus = preparePanelLines(panelScroll.status, statusLinesWrapped, layout.status.innerHeight, false);

    const serverLines = buildServerLines(layout.server.innerWidth, panelThemes.server);
    const visibleServer = preparePanelLines(panelScroll.server, serverLines, layout.server.innerHeight, false);

    const sizeChanged = !screenBuffer || bufferWidth !== width || bufferHeight !== height;
    if (sizeChanged) {
        screenBuffer = ScreenBuffer.create({ width, height });
        bufferWidth = width;
        bufferHeight = height;
        screenBuffer.prevCells = screenBuffer._cloneCells();
        stdout.write(CLEAR_SCREEN + cursorTo(1, 1));
    }

    screenBuffer.fill({ char: ' ' });
    const context = {
        borderAttr: (x, y, isFocused) => gradientBorderAttr(x, y, isFocused),
        titleAttr: (x, y, state) => gradientTitleAttr(x, y, state)
    };

    renderChatPanel(screenBuffer, layout.chat, visibleLogs, focusedPanel === 'chat', context, panelThemes.chat);
    renderStatusPanel(screenBuffer, layout.status, visibleStatus, focusedPanel === 'status', context, panelThemes.status);
    drawPanelDivider(screenBuffer, layout.status, layout.server);
    renderServerPanel(screenBuffer, layout.server, visibleServer, focusedPanel === 'server', context, panelThemes.server);
    renderInputPanel(screenBuffer, layout.input, inputBuffer, context, panelThemes.input, { showCursor: true });

    if (instanceModal && instanceModal.isVisible()) {
        instanceModal.render(screenBuffer, layout);
    }

    screenBuffer.draw({ delta: true });
}

function computeLogLines(width) {
    if (width <= 0) return [];
    const lines = [];
    logEntries.forEach(entry => {
        if (!entry) return;
        if (entry.type === 'segments') {
            const wrapped = wrapSegments(entry.segments, width);
            wrapped.forEach(line => lines.push({ kind: 'segments', segments: line }));
            if (!wrapped.length) {
                lines.push(null);
            }
            return;
        }
        const safeText = entry.text === undefined || entry.text === null ? '' : String(entry.text);
        const baseText = entry.type === 'system' ? `[SYS] ${safeText}` : safeText;
        const wrapped = wrapText(baseText, width);
        wrapped.forEach(chunk => lines.push({ kind: 'plain', text: chunk, color: entry.type === 'system' ? entry.color || 'cyan' : null }));
        if (!wrapped.length) {
            lines.push({ kind: 'plain', text: '', color: null });
        }
    });
    return lines.length ? lines : [null];
}

function buildStatusLines(innerWidth) {
    if (innerWidth <= 0) return [];
    const lines = [];
    statusLines.forEach(line => {
        wrapText(line || '', innerWidth).forEach(chunk => lines.push(chunk));
    });
    return lines.length ? lines : [''];
}

function buildServerLines(innerWidth, theme = {}) {
    const lines = [];
    const host = serverInfo.host || 'N/A';
    lines.push({ kind: 'plain', text: `IP: ${host}` });
    const uptime = serverInfo.onlineTimeMs > 0 ? formatDuration(serverInfo.onlineTimeMs) : 'N/A';
    lines.push({ kind: 'plain', text: `Online: ${uptime}` });
    const players = Array.isArray(serverInfo.players) ? serverInfo.players.filter(Boolean) : [];
    lines.push({ kind: 'plain', text: `Players: ${players.length}` });
    if (!players.length) {
        lines.push({ kind: 'plain', text: 'No players online.' });
    } else {
        lines.push({ kind: 'plain', text: 'Players online:' });
        const playerRows = buildPlayerRows(players, innerWidth, theme);
        playerRows.forEach(row => lines.push(row));
    }
    return lines;
}

function buildPlayerRows(players, innerWidth, theme = {}) {
    const rows = [];
    if (innerWidth <= 0) return rows;
    const gapWidth = innerWidth >= 30 ? 2 : 1;
    const minColumnWidth = 14;
    const useTwoColumns = innerWidth >= (minColumnWidth * 2 + gapWidth);
    if (!useTwoColumns) {
        players.forEach((name, idx) => {
            rows.push({ kind: 'segments', segments: createPlayerCellSegments(name, idx, theme) });
        });
        return rows;
    }
    const columnWidth = Math.max(minColumnWidth, Math.floor((innerWidth - gapWidth) / 2));
    for (let i = 0; i < players.length; i += 2) {
        const rowSegments = [];
        appendColumnSegments(rowSegments, createPlayerCellSegments(players[i], i, theme), columnWidth);
        const rightName = players[i + 1];
        if (rightName) {
            if (gapWidth > 0) {
                rowSegments.push(createSegment(' '.repeat(gapWidth), {}));
            }
            appendColumnSegments(rowSegments, createPlayerCellSegments(rightName, i + 1, theme), columnWidth);
        }
        rows.push({ kind: 'segments', segments: rowSegments });
    }
    return rows;
}

function createPlayerCellSegments(rawName, idx, theme = {}) {
    const segments = [createSegment('• ', { color: '#888888' })];
    const displayName = typeof rawName === 'string' && rawName.length ? rawName : 'Unknown';
    const baseSegments = isBotName(displayName)
        ? rainbowifyText(displayName, idx)
        : [createSegment(displayName, { color: theme.textColor || '#ffffff' })];
    baseSegments.forEach(seg => segments.push(seg));
    return segments;
}

function appendColumnSegments(target, sourceSegments, widthLimit) {
    if (!Array.isArray(target)) return;
    const normalized = Array.isArray(sourceSegments) ? sourceSegments : [];
    if (!widthLimit || widthLimit <= 0) {
        normalized.forEach(seg => target.push(seg));
        return;
    }
    const copy = copySegmentsWithinWidth(normalized, widthLimit);
    copy.segments.forEach(seg => target.push(seg));
    const remaining = Math.max(0, widthLimit - copy.width);
    if (remaining > 0) {
        target.push(createSegment(' '.repeat(remaining), {}));
    }
}

function copySegmentsWithinWidth(segments, widthLimit) {
    const result = [];
    if (!Array.isArray(segments) || widthLimit <= 0) {
        return { segments: result, width: 0 };
    }
    let used = 0;
    outer: for (const seg of segments) {
        if (!seg || typeof seg.text !== 'string' || !seg.text.length) continue;
        let buffer = '';
        for (const char of seg.text) {
            const charW = Math.max(0, charWidth(char));
            if (charW === 0) continue;
            if (used + charW > widthLimit) {
                if (buffer) {
                    result.push({ text: buffer, state: seg.state || {} });
                }
                used = widthLimit;
                break outer;
            }
            buffer += char;
            used += charW;
        }
        if (buffer) {
            result.push({ text: buffer, state: seg.state || {} });
        }
        if (used >= widthLimit) {
            break;
        }
    }
    return { segments: result, width: Math.min(used, widthLimit) };
}

function isBotName(name) {
    if (!name || !serverInfo.botUsername) return false;
    return name.toLowerCase() === serverInfo.botUsername.toLowerCase();
}

function rainbowifyText(text, indexOffset = 0) {
    const segments = [];
    let idx = 0;
    for (const char of text) {
        const color = animatedRainbowColor(indexOffset * 50 + idx * 35);
        segments.push(createSegment(char, { color, bold: true }));
        idx++;
    }
    return segments;
}

function drawPanelDivider(buffer, statusRegion, serverRegion) {
    if (!statusRegion || !serverRegion) return;
    const dividerY = serverRegion.y - 1;
    if (dividerY <= 0) return;
    const statusBottom = statusRegion.y + statusRegion.h - 1;
    if (dividerY <= statusBottom) return;
    const startX = serverRegion.x;
    const width = Math.min(statusRegion.w, serverRegion.w);
    if (width <= 0) return;
    for (let col = 0; col < width; col++) {
        const x = startX + col;
        const attr = gradientBorderAttr(x, dividerY, true);
        buffer.put({ x, y: dividerY, attr }, '─');
    }
}

function panelFromCoordinates(x, y) {
    if (!lastLayout) return null;
    for (const key of FOCUSABLE_PANELS) {
        const region = lastLayout[key];
        if (region && pointInRegion(x, y, region)) {
            return key;
        }
    }
    return null;
}

function gradientColorFor(x, y) {
    const width = bufferWidth || stdout.columns || 80;
    const height = bufferHeight || stdout.rows || 24;
    const diag = Math.max(1, width + height);
    const phase = ((Date.now() - animationStart) % GRADIENT_PERIOD_MS) / GRADIENT_PERIOD_MS;
    return pastelHue(mod1(((x + y) / diag) + phase));
}

function gradientBorderAttr(x, y, bold = false) {
    const color = gradientColorFor(x, y);
    return buildAttr({ bold }, color);
}

function gradientTitleAttr(x, y, state = {}) {
    const color = gradientColorFor(x, y);
    const merged = { ...state, color, bold: state.bold !== false };
    return buildAttr(merged);
}

function animatedRainbowColor(offsetMs = 0) {
    const phase = mod1(((Date.now() + offsetMs) % MAX_RAINBOW_PHASE) / MAX_RAINBOW_PHASE);
    return pastelHue(phase);
}

function pastelHue(value) {
    const hue = mod1(value) * 360;
    return hslToHex(hue, 0.45, 0.78);
}

function hslToHex(h, s, l) {
    const sat = clamp(s, 0, 1);
    const light = clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = (h % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hp >= 0 && hp < 1) {
        r1 = c; g1 = x; b1 = 0;
    } else if (hp >= 1 && hp < 2) {
        r1 = x; g1 = c; b1 = 0;
    } else if (hp >= 2 && hp < 3) {
        r1 = 0; g1 = c; b1 = x;
    } else if (hp >= 3 && hp < 4) {
        r1 = 0; g1 = x; b1 = c;
    } else if (hp >= 4 && hp < 5) {
        r1 = x; g1 = 0; b1 = c;
    } else {
        r1 = c; g1 = 0; b1 = x;
    }
    const m = light - c / 2;
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
    const clamped = clamp(Math.round(value), 0, 255);
    return clamped.toString(16).padStart(2, '0');
}

function mod1(value) {
    const result = value - Math.floor(value);
    return result < 0 ? result + 1 : result;
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds >= 3600) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
    if (totalSeconds >= 60) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }
    return `${totalSeconds}s`;
}

function isInteractiveTerminal() {
    return Boolean(stdout && stdout.isTTY && stdin && stdin.isTTY);
}

function configureThemeManager(themeManager) {
    if (!themeCleanupRegistered) {
        process.once('exit', () => {
            if (typeof detachThemeListener === 'function') {
                detachThemeListener();
            }
        });
        themeCleanupRegistered = true;
    }
    if (typeof detachThemeListener === 'function') {
        detachThemeListener();
        detachThemeListener = null;
    }

    const applyPanels = (panelConfig) => {
        setPanelThemesFromConfig(panelConfig);
        if (uiReady) {
            scheduleRender();
        }
    };

    if (!themeManager || typeof themeManager.getActivePanels !== 'function' || typeof themeManager.on !== 'function') {
        applyPanels();
        return;
    }

    applyPanels(themeManager.getActivePanels());
    const handleChange = (payload = {}) => applyPanels(payload.panelConfig);
    themeManager.on('change', handleChange);
    detachThemeListener = () => {
        themeManager.off('change', handleChange);
        detachThemeListener = null;
    };
}

module.exports = {
    initCli,
    setConsoleHandlers,
    logChatMessage,
    forwardSystemLog,
    updateUiStatus,
    updateServerInfo
};
