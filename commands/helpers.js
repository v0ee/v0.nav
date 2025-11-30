function handleNumericConfig(respond, rawValue, label, setter, currentValue) {
    if (!rawValue) {
        respond(`Current ${label}: ${currentValue}`);
        return;
    }
    const value = parseFloat(rawValue);
    if (Number.isNaN(value)) {
        respond(`Invalid number for ${label}.`, 'red');
        return;
    }
    setter(value);
    respond(`${label} set to ${value}.`);
}

module.exports = {
    handleNumericConfig
};
