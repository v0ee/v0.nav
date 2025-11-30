const UUID_PLAIN = /^[0-9a-f]{32}$/i;
const UUID_HYPHEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
    if (!value) return false;
    return UUID_PLAIN.test(value.replace(/-/g, '')) || UUID_HYPHEN.test(value);
}

function normalizeUuid(value) {
    if (!value) return null;
    const stripped = value.replace(/-/g, '').toLowerCase();
    if (!UUID_PLAIN.test(stripped)) return null;
    return `${stripped.slice(0, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12, 16)}-${stripped.slice(16, 20)}-${stripped.slice(20)}`;
}

module.exports = {
    isUuid,
    normalizeUuid
};
