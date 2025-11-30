const { createSegment } = require('../colors');
const { DEFAULT_BORDER, DEFAULT_THEME_CONFIG, PANEL_KEYS } = require('../../lib/themeDefaults');

const TITLE_PADDING = 2;

let panelThemes = buildPanelThemes(DEFAULT_THEME_CONFIG.themes[DEFAULT_THEME_CONFIG.activeTheme]?.panels);

function buildPanelThemes(rawPanels = {}) {
    const basePanels = DEFAULT_THEME_CONFIG.themes[DEFAULT_THEME_CONFIG.activeTheme]?.panels || {};
    const themes = {};
    PANEL_KEYS.forEach(key => {
        themes[key] = mergePanelTheme(basePanels[key], rawPanels[key]);
    });
    return themes;
}

function mergePanelTheme(base = {}, override = {}) {
    const merged = {
        title: override.title || base.title || '',
        subtitle: override.subtitle !== undefined ? override.subtitle : base.subtitle,
        defaultColor: override.defaultColor || base.defaultColor || '#ffffff',
        bodyBg: override.bodyBg || base.bodyBg || '#000000',
        textColor: override.textColor || base.textColor || '#ffffff'
    };
    const segmentSource = Array.isArray(override.titleSegments) && override.titleSegments.length
        ? override.titleSegments
        : Array.isArray(base.titleSegments) ? base.titleSegments : [];
    merged.titleSegments = buildSegments(segmentSource, merged.title);
    return merged;
}

function buildSegments(definitions = [], fallbackTitle = '') {
    if (Array.isArray(definitions) && definitions.length) {
        return definitions
            .map(def => {
                if (!def || typeof def.text !== 'string' || !def.text.length) {
                    return null;
                }
                const { text, ...state } = def;
                return createSegment(text, state);
            })
            .filter(Boolean);
    }
    if (fallbackTitle) {
        return [createSegment(` ${fallbackTitle} `, { bold: true })];
    }
    return [];
}

function setPanelThemesFromConfig(rawPanels = {}) {
    panelThemes = buildPanelThemes(rawPanels);
}

function getPanelThemes() {
    return panelThemes;
}

module.exports = {
    TITLE_PADDING,
    DEFAULT_BORDER,
    getPanelThemes,
    setPanelThemesFromConfig
};
