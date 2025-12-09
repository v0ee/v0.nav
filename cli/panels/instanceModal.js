const { buildAttr } = require('../colors');
const { clamp } = require('../screenbuffer');

const MODAL_MIN_WIDTH = 45;
const MODAL_MAX_WIDTH = 65;
const MODAL_PADDING = 2;

class InstanceModal {
    constructor(options = {}) {
        this.instanceManager = options.instanceManager;
        this.multiBotManager = options.multiBotManager;
        this.onStart = options.onStart || (() => {});
        this.onStop = options.onStop || (() => {});
        this.onSetActive = options.onSetActive || (() => {});
        this.onClose = options.onClose || (() => {});
        this.onAddNew = options.onAddNew || (() => {});
        
        this.visible = false;
        this.selectedIndex = 0;
        this.mode = 'list'; 
        this.addInputBuffer = '';
        this.addField = 'name'; 
        this.newInstanceData = { name: '', host: '0b0t.org', username: '' };
        this.actionTargetId = null;
    }

    show() {
        this.visible = true;
        this.selectedIndex = 0;
        this.mode = 'list';
        this.addInputBuffer = '';
        this.newInstanceData = { name: '', host: '0b0t.org', username: '' };
    }

    hide() {
        this.visible = false;
        this.mode = 'list';
        this.onClose();
    }

    toggle() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    isVisible() {
        return this.visible;
    }

    isRunning(instanceId) {
        return this.multiBotManager?.isRunning(instanceId) || false;
    }

    getActiveInstanceId() {
        return this.multiBotManager?.getActiveInstanceId() || null;
    }

    getMenuItems() {
        if (!this.instanceManager) return [];
        const instances = this.instanceManager.getInstances();
        const activeId = this.getActiveInstanceId();
        
        const items = instances.map((inst, idx) => ({
            type: 'instance',
            id: inst.id,
            label: inst.name,
            host: inst.minecraft?.host || 'N/A',
            isRunning: this.isRunning(inst.id),
            isActive: inst.id === activeId,
            index: idx
        }));
        
        items.push({
            type: 'action',
            id: 'add-new',
            label: '+ Add New Instance',
            index: items.length
        });
        
        return items;
    }

    handleKeypress(str, key = {}) {
        if (!this.visible) return false;
        
        if (this.mode === 'add') {
            return this.handleAddModeKeypress(str, key);
        }
        
        if (this.mode === 'confirm-delete') {
            return this.handleDeleteConfirmKeypress(str, key);
        }

        if (this.mode === 'confirm-stop') {
            return this.handleStopConfirmKeypress(str, key);
        }
        
        const items = this.getMenuItems();
        
        switch (key.name) {
            case 'escape':
                this.hide();
                return true;
                
            case 'up':
                this.selectedIndex = Math.max(0, this.selectedIndex - 1);
                return true;
                
            case 'down':
                this.selectedIndex = Math.min(items.length - 1, this.selectedIndex + 1);
                return true;
                
            case 'return':
            case 'enter':
                this.handleEnterOnItem();
                return true;
                
            case 'delete':
                this.initiateDelete();
                return true;
                
            default:
                break;
        }

        if (str === 's' || str === 'S') {
            this.toggleInstanceRunning();
            return true;
        }

        if (str === 'a' || str === 'A') {
            this.setAsActive();
            return true;
        }
        
        if (str && /^[1-9]$/.test(str)) {
            const idx = parseInt(str, 10) - 1;
            if (idx < items.length) {
                this.selectedIndex = idx;
                return true;
            }
        }
        
        return true;
    }

    handleAddModeKeypress(str, key = {}) {
        switch (key.name) {
            case 'escape':
                this.mode = 'list';
                this.addInputBuffer = '';
                return true;
                
            case 'return':
            case 'enter':
                this.advanceAddField();
                return true;
                
            case 'backspace':
            case 'delete':
                if (this.addInputBuffer.length > 0) {
                    this.addInputBuffer = this.addInputBuffer.slice(0, -1);
                }
                return true;
                
            case 'tab':
                this.cycleAddField(!!key.shift);
                return true;
                
            default:
                if (str && !key.ctrl && !key.meta) {
                    this.addInputBuffer += str;
                }
                return true;
        }
    }

    handleDeleteConfirmKeypress(str, key = {}) {
        if (key.name === 'escape' || str === 'n' || str === 'N') {
            this.mode = 'list';
            this.actionTargetId = null;
            return true;
        }
        
        if (str === 'y' || str === 'Y' || key.name === 'return') {
            this.confirmDelete();
            return true;
        }
        
        return true;
    }

    handleStopConfirmKeypress(str, key = {}) {
        if (key.name === 'escape' || str === 'n' || str === 'N') {
            this.mode = 'list';
            this.actionTargetId = null;
            return true;
        }
        
        if (str === 'y' || str === 'Y' || key.name === 'return') {
            this.confirmStop();
            return true;
        }
        
        return true;
    }

    handleEnterOnItem() {
        const items = this.getMenuItems();
        const item = items[this.selectedIndex];
        
        if (!item) return;
        
        if (item.type === 'action' && item.id === 'add-new') {
            this.startAddMode();
            return;
        }
        
        if (item.type === 'instance') {
            this.toggleInstanceRunning();
        }
    }

    toggleInstanceRunning() {
        const items = this.getMenuItems();
        const item = items[this.selectedIndex];
        
        if (!item || item.type !== 'instance') return;
        
        const instance = this.instanceManager.getInstance(item.id);
        if (!instance) return;

        if (this.isRunning(item.id)) {
            this.actionTargetId = item.id;
            this.mode = 'confirm-stop';
        } else {
            this.onStart(instance);
        }
    }

    setAsActive() {
        const items = this.getMenuItems();
        const item = items[this.selectedIndex];
        
        if (!item || item.type !== 'instance') return;
        if (!this.isRunning(item.id)) return;
        
        this.onSetActive(item.id);
    }

    confirmStop() {
        if (!this.actionTargetId) {
            this.mode = 'list';
            return;
        }
        
        this.onStop(this.actionTargetId);
        this.actionTargetId = null;
        this.mode = 'list';
    }

    startAddMode() {
        this.mode = 'add';
        this.addField = 'name';
        this.addInputBuffer = '';
        this.newInstanceData = { name: '', host: '0b0t.org', username: '' };
    }

    advanceAddField() {
        this.newInstanceData[this.addField] = this.addInputBuffer;
        
        if (this.addField === 'name') {
            this.addField = 'host';
            this.addInputBuffer = this.newInstanceData.host;
        } else if (this.addField === 'host') {
            this.addField = 'username';
            this.addInputBuffer = this.newInstanceData.username;
        } else if (this.addField === 'username') {
            this.createNewInstance();
        }
    }

    cycleAddField(reverse = false) {
        this.newInstanceData[this.addField] = this.addInputBuffer;
        
        const fields = ['name', 'host', 'username'];
        const currentIdx = fields.indexOf(this.addField);
        const nextIdx = reverse 
            ? (currentIdx - 1 + fields.length) % fields.length
            : (currentIdx + 1) % fields.length;
        
        this.addField = fields[nextIdx];
        this.addInputBuffer = this.newInstanceData[this.addField] || '';
    }

    createNewInstance() {
        if (!this.instanceManager) return;
        
        const name = this.newInstanceData.name.trim() || `Instance ${this.instanceManager.getInstanceCount() + 1}`;
        const minecraft = {
            host: this.newInstanceData.host.trim() || '0b0t.org',
            username: this.newInstanceData.username.trim() || 'FlightBot',
            auth: 'microsoft',
            version: '1.20.4'
        };
        
        const instance = this.instanceManager.addInstanceSync(name, minecraft);
        this.mode = 'list';
        this.selectedIndex = this.instanceManager.getInstances().length - 1;
        this.onAddNew(instance);
    }

    initiateDelete() {
        const items = this.getMenuItems();
        const item = items[this.selectedIndex];
        
        if (!item || item.type !== 'instance') return;
        if (this.instanceManager.getInstanceCount() <= 1) return;
        if (this.isRunning(item.id)) return;
        
        this.actionTargetId = item.id;
        this.mode = 'confirm-delete';
    }

    async confirmDelete() {
        if (!this.actionTargetId || !this.instanceManager) {
            this.mode = 'list';
            return;
        }
        
        await this.instanceManager.removeInstance(this.actionTargetId);
        this.actionTargetId = null;
        this.mode = 'list';
        this.selectedIndex = Math.min(this.selectedIndex, this.instanceManager.getInstanceCount());
    }

    render(screenBuffer, layout) {
        if (!this.visible || !screenBuffer) return;
        
        const termWidth = layout?.input?.w || 80;
        const termHeight = (layout?.chat?.h || 20) + (layout?.input?.h || 3);
        
        const items = this.getMenuItems();
        const contentHeight = this.mode === 'add' ? 10 : this.mode === 'confirm-delete' || this.mode === 'confirm-stop' ? 6 : items.length + 6;
        const modalWidth = clamp(MODAL_MAX_WIDTH, MODAL_MIN_WIDTH, termWidth - 4);
        const modalHeight = clamp(contentHeight, 6, termHeight - 4);
        
        const modalX = Math.floor((termWidth - modalWidth) / 2) + 1;
        const modalY = Math.floor((termHeight - modalHeight) / 2) + 1;
        
        this.drawBackdrop(screenBuffer, termWidth, termHeight);
        
        this.drawModalBox(screenBuffer, modalX, modalY, modalWidth, modalHeight);
        
        if (this.mode === 'add') {
            this.drawAddMode(screenBuffer, modalX, modalY, modalWidth, modalHeight);
        } else if (this.mode === 'confirm-delete') {
            this.drawDeleteConfirm(screenBuffer, modalX, modalY, modalWidth, modalHeight);
        } else if (this.mode === 'confirm-stop') {
            this.drawStopConfirm(screenBuffer, modalX, modalY, modalWidth, modalHeight);
        } else {
            this.drawInstanceList(screenBuffer, modalX, modalY, modalWidth, modalHeight, items);
        }
    }

    drawBackdrop(buffer, width, height) {
        const dimAttr = buildAttr({ dim: true }, '#1a1b26');
        for (let y = 1; y <= height; y++) {
            for (let x = 1; x <= width; x++) {
                buffer.put({ x, y, attr: dimAttr }, '░');
            }
        }
    }

    drawModalBox(buffer, x, y, width, height) {
        const borderAttr = buildAttr({ bold: true }, '#7aa2f7');
        const bgAttr = buildAttr({}, '#1a1b26');
        
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                buffer.put({ x: x + col, y: y + row, attr: bgAttr }, ' ');
            }
        }
        
        buffer.put({ x, y, attr: borderAttr }, '╭');
        buffer.put({ x: x + width - 1, y, attr: borderAttr }, '╮');
        buffer.put({ x, y: y + height - 1, attr: borderAttr }, '╰');
        buffer.put({ x: x + width - 1, y: y + height - 1, attr: borderAttr }, '╯');
        
        for (let col = 1; col < width - 1; col++) {
            buffer.put({ x: x + col, y, attr: borderAttr }, '─');
            buffer.put({ x: x + col, y: y + height - 1, attr: borderAttr }, '─');
        }
        
        for (let row = 1; row < height - 1; row++) {
            buffer.put({ x, y: y + row, attr: borderAttr }, '│');
            buffer.put({ x: x + width - 1, y: y + row, attr: borderAttr }, '│');
        }
        
        const title = ' Instance Manager ';
        const titleX = x + Math.floor((width - title.length) / 2);
        const titleAttr = buildAttr({ bold: true }, '#bb9af7');
        this.drawText(buffer, titleX, y, title, titleAttr);
    }

    drawInstanceList(buffer, x, y, width, height, items) {
        const contentX = x + MODAL_PADDING;
        const contentWidth = width - (MODAL_PADDING * 2);
        let row = y + 1;
        
        const runningCount = this.multiBotManager?.getRunningCount() || 0;
        const countText = `Running: ${runningCount} instance${runningCount !== 1 ? 's' : ''}`;
        const countAttr = buildAttr({}, runningCount > 0 ? '#9ece6a' : '#565f89');
        this.drawText(buffer, contentX, row, countText, countAttr);
        row++;
        
        const helpText = '↑↓:Nav Enter/S:Start/Stop A:Active Del:Remove';
        const helpAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, contentX, row, helpText.slice(0, contentWidth), helpAttr);
        row += 2;
        
        const maxVisible = height - 6;
        const startIdx = Math.max(0, this.selectedIndex - Math.floor(maxVisible / 2));
        const endIdx = Math.min(items.length, startIdx + maxVisible);
        
        for (let i = startIdx; i < endIdx; i++) {
            const item = items[i];
            const isSelected = i === this.selectedIndex;
            
            if (item.type === 'instance') {
                this.drawInstanceItem(buffer, contentX, row, contentWidth, item, isSelected);
            } else if (item.type === 'action') {
                this.drawActionItem(buffer, contentX, row, contentWidth, item, isSelected);
            }
            row++;
        }
    }

    drawInstanceItem(buffer, x, y, width, item, isSelected) {
        const prefix = isSelected ? '→ ' : '  ';
        const indexNum = `${item.index + 1}. `;
        
        let statusIcon = '○';
        let statusColor = '#565f89';
        if (item.isRunning) {
            statusIcon = '●';
            statusColor = item.isActive ? '#9ece6a' : '#7aa2f7';
        }
        
        const activeMarker = item.isActive ? ' [ACTIVE]' : '';
        
        const labelMaxLen = width - prefix.length - indexNum.length - 4 - item.host.length - activeMarker.length;
        const label = item.label.length > labelMaxLen 
            ? item.label.slice(0, labelMaxLen - 1) + '…' 
            : item.label;
        
        let col = x;
        
        const prefixAttr = buildAttr({ bold: isSelected }, isSelected ? '#7aa2f7' : '#565f89');
        this.drawText(buffer, col, y, prefix, prefixAttr);
        col += prefix.length;
        
        const statusAttr = buildAttr({ bold: item.isRunning }, statusColor);
        this.drawText(buffer, col, y, statusIcon + ' ', statusAttr);
        col += 2;
        
        const numAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, col, y, indexNum, numAttr);
        col += indexNum.length;
        
        const labelAttr = buildAttr({ bold: isSelected }, isSelected ? '#c0caf5' : '#a9b1d6');
        this.drawText(buffer, col, y, label, labelAttr);
        col += label.length;
        
        const hostPart = ` (${item.host})`;
        const hostAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, col, y, hostPart, hostAttr);
        col += hostPart.length;
        
        if (item.isActive) {
            const activeAttr = buildAttr({ bold: true }, '#9ece6a');
            this.drawText(buffer, col, y, activeMarker, activeAttr);
        }
    }

    drawActionItem(buffer, x, y, width, item, isSelected) {
        const prefix = isSelected ? '▶ ' : '  ';
        
        const prefixAttr = buildAttr({ bold: isSelected }, isSelected ? '#7aa2f7' : '#565f89');
        this.drawText(buffer, x, y, prefix, prefixAttr);
        
        const labelAttr = buildAttr({ bold: isSelected }, isSelected ? '#9ece6a' : '#73daca');
        this.drawText(buffer, x + prefix.length + 2, y, item.label, labelAttr);
    }

    drawAddMode(buffer, x, y, width, height) {
        const contentX = x + MODAL_PADDING;
        const contentWidth = width - (MODAL_PADDING * 2);
        let row = y + 1;
        
        const title = 'Create New Instance';
        const titleAttr = buildAttr({ bold: true }, '#bb9af7');
        this.drawText(buffer, contentX, row, title, titleAttr);
        row += 2;
        
        const fields = [
            { key: 'name', label: 'Name:', placeholder: 'Instance name' },
            { key: 'host', label: 'Host:', placeholder: '0b0t.org' },
            { key: 'username', label: 'Username:', placeholder: 'BotUsername' }
        ];
        
        for (const field of fields) {
            const isActive = this.addField === field.key;
            const value = field.key === this.addField 
                ? this.addInputBuffer 
                : (this.newInstanceData[field.key] || '');
            
            const labelAttr = buildAttr({ bold: isActive }, isActive ? '#7aa2f7' : '#a9b1d6');
            this.drawText(buffer, contentX, row, field.label, labelAttr);
            
            const inputX = contentX + 12;
            const inputWidth = contentWidth - 14;
            const displayValue = value || (isActive ? '' : field.placeholder);
            const valueAttr = buildAttr({ dim: !value && !isActive }, isActive ? '#c0caf5' : '#565f89');
            
            const boxAttr = buildAttr({}, isActive ? '#3d59a1' : '#24283b');
            for (let i = 0; i < inputWidth; i++) {
                buffer.put({ x: inputX + i, y: row, attr: boxAttr }, ' ');
            }
            
            this.drawText(buffer, inputX, row, displayValue.slice(0, inputWidth - 1), valueAttr);
            
            if (isActive) {
                const cursorX = inputX + Math.min(this.addInputBuffer.length, inputWidth - 2);
                const cursorAttr = buildAttr({ bold: true }, '#7aa2f7');
                buffer.put({ x: cursorX, y: row, attr: cursorAttr }, '█');
            }
            
            row++;
        }
        
        row++;
        
        const helpText = 'Tab: Next  Enter: Confirm  Esc: Cancel';
        const helpAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, contentX, row, helpText, helpAttr);
    }

    drawDeleteConfirm(buffer, x, y, width, height) {
        const contentX = x + MODAL_PADDING;
        let row = y + 2;
        
        const item = this.instanceManager?.getInstance(this.actionTargetId);
        const name = item?.name || 'this instance';
        
        const msgAttr = buildAttr({}, '#c0caf5');
        this.drawText(buffer, contentX, row, `Delete "${name}"?`, msgAttr);
        row += 2;
        
        const helpAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, contentX, row, 'Y: Yes  N: No  Esc: Cancel', helpAttr);
    }

    drawStopConfirm(buffer, x, y, width, height) {
        const contentX = x + MODAL_PADDING;
        let row = y + 2;
        
        const item = this.instanceManager?.getInstance(this.actionTargetId);
        const name = item?.name || 'this instance';
        
        const msgAttr = buildAttr({}, '#f7768e');
        this.drawText(buffer, contentX, row, `Stop "${name}"?`, msgAttr);
        row += 2;
        
        const helpAttr = buildAttr({ dim: true }, '#565f89');
        this.drawText(buffer, contentX, row, 'Y: Yes  N: No  Esc: Cancel', helpAttr);
    }

    drawText(buffer, x, y, text, attr) {
        if (!text) return;
        for (let i = 0; i < text.length; i++) {
            buffer.put({ x: x + i, y, attr }, text[i]);
        }
    }
}

function createInstanceModal(options = {}) {
    return new InstanceModal(options);
}

module.exports = {
    InstanceModal,
    createInstanceModal
};
