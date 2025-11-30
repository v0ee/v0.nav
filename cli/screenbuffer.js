const stdout = process.stdout;
const ESC = '\u001b[';
const RESET = '\u001b[0m';

const { DEFAULT_ATTR, ensureAttr } = require('./colors');

class ScreenBuffer {
    constructor({ width, height }) {
        this.width = Math.max(1, width || 1);
        this.height = Math.max(1, height || 1);
        this.cells = this._createCells();
        this.prevCells = this._cloneCells();
    }

    static create(options) {
        return new ScreenBuffer(options);
    }

    clear(char = ' ') {
        this.fill({ char });
    }

    fill(options = {}) {
        const {
            x = 1,
            y = 1,
            width = this.width,
            height = this.height,
            char = ' ',
            attr = DEFAULT_ATTR
        } = options;
        const normalizedAttr = ensureAttr(attr);
        const startX = clamp(x, 1, this.width);
        const startY = clamp(y, 1, this.height);
        const endX = clamp(x + width - 1, 1, this.width);
        const endY = clamp(y + height - 1, 1, this.height);
        for (let row = startY; row <= endY; row++) {
            for (let col = startX; col <= endX; col++) {
                this._setCell(col, row, char, normalizedAttr, false);
            }
        }
    }

    put(options = {}, text = '') {
        if (!text) return;
        const attr = ensureAttr(options.attr);
        let x = clamp(options.x || 1, 1, this.width);
        const y = options.y || 1;
        if (y < 1 || y > this.height) return;
        for (const rune of text) {
            const width = Math.max(0, charWidth(rune));
            if (width === 0) continue;
            if (x > this.width) break;
            if (width === 2 && x === this.width) break;
            this._setCell(x, y, rune, attr, false);
            if (width === 2) {
                this._setCell(x + 1, y, '', attr, true);
                x += 2;
            } else {
                x += 1;
            }
        }
    }

    draw(options = {}) {
        const delta = options.delta !== false;
        if (!stdout.isTTY) return;
        let output = '';
        for (let row = 1; row <= this.height; row++) {
            const rowChanged = !delta || this._rowChanged(row);
            if (!rowChanged) continue;
            output += cursorTo(1, row);
            output += this._rowToString(row);
        }
        if (!output) return;
        stdout.write(output + RESET);
        this._syncPrevCells();
    }

    _createCells() {
        const size = this.width * this.height;
        const cells = new Array(size);
        for (let i = 0; i < size; i++) {
            cells[i] = this._makeCell(' ', DEFAULT_ATTR, false);
        }
        return cells;
    }

    _makeCell(char, attr, continuation) {
        return {
            char: char || ' ',
            attr: attr || DEFAULT_ATTR,
            continuation: !!continuation
        };
    }

    _rowChanged(row) {
        if (!this.prevCells) return true;
        const offset = (row - 1) * this.width;
        for (let col = 0; col < this.width; col++) {
            const idx = offset + col;
            if (!cellsEqual(this.cells[idx], this.prevCells[idx])) {
                return true;
            }
        }
        return false;
    }

    _rowToString(row) {
        const offset = (row - 1) * this.width;
        let line = '';
        let activeKey = DEFAULT_ATTR.key;
        for (let col = 0; col < this.width; col++) {
            const cell = this.cells[offset + col];
            const attr = cell.attr || DEFAULT_ATTR;
            if (attr.key !== activeKey) {
                line += attr.sequence;
                activeKey = attr.key;
            }
            if (!cell.continuation) {
                line += cell.char || ' ';
            }
        }
        if (activeKey !== DEFAULT_ATTR.key) {
            line += RESET;
        }
        return line;
    }

    _setCell(x, y, char, attr, continuation) {
        if (x < 1 || x > this.width || y < 1 || y > this.height) return;
        const idx = (y - 1) * this.width + (x - 1);
        this.cells[idx] = this._makeCell(char, attr, continuation);
    }

    _cloneCells() {
        return this.cells.map(cell => ({
            char: cell.char,
            attr: cell.attr,
            continuation: cell.continuation
        }));
    }

    _syncPrevCells() {
        if (!this.prevCells || this.prevCells.length !== this.cells.length) {
            this.prevCells = this._cloneCells();
            return;
        }
        for (let i = 0; i < this.cells.length; i++) {
            const current = this.cells[i];
            const prev = this.prevCells[i];
            if (!prev) {
                this.prevCells[i] = this._makeCell(current.char, current.attr, current.continuation);
                continue;
            }
            prev.char = current.char;
            prev.attr = current.attr;
            prev.continuation = current.continuation;
        }
    }
}

const COMBINING_RANGES = [
    [0x0300, 0x036f],
    [0x1ab0, 0x1aff],
    [0x1dc0, 0x1dff],
    [0x20d0, 0x20ff],
    [0xfe20, 0xfe2f]
];

function charWidth(char) {
    if (!char) return 0;
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return 0;
    if (codePoint === 0) return 0;
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
    if (isCombiningMark(codePoint)) return 0;
    if (isFullWidthCodePoint(codePoint)) return 2;
    return 1;
}

function takeByWidth(str, maxWidth) {
    if (maxWidth <= 0 || !str) return { text: '', width: 0 };
    let used = 0;
    let out = '';
    for (const char of String(str)) {
        const charW = Math.max(0, charWidth(char));
        if (charW > maxWidth) continue;
        if (charW > 0 && used + charW > maxWidth) break;
        out += char;
        if (charW > 0) {
            used += charW;
            if (used >= maxWidth) break;
        }
    }
    return { text: out, width: used };
}

function cursorTo(x, y) {
    return `${ESC}${y};${x}H`;
}

function cellsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const keyA = a.attr ? a.attr.key : DEFAULT_ATTR.key;
    const keyB = b.attr ? b.attr.key : DEFAULT_ATTR.key;
    return a.char === b.char && a.continuation === b.continuation && keyA === keyB;
}

function isCombiningMark(codePoint) {
    return COMBINING_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isFullWidthCodePoint(codePoint) {
    return (
        codePoint >= 0x1100 &&
        (
            codePoint <= 0x115f ||
            codePoint === 0x2329 ||
            codePoint === 0x232a ||
            (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
            (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
            (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
            (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
            (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
            (codePoint >= 0xff00 && codePoint <= 0xff60) ||
            (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
            (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
            (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
            (codePoint >= 0x20000 && codePoint <= 0x3fffd)
        )
    );
}

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

module.exports = {
    ScreenBuffer,
    charWidth,
    takeByWidth,
    cursorTo,
    clamp
};
