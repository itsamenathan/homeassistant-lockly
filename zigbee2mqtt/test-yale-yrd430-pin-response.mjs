import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    addExternalDefinition,
    findByDevice,
    prepareDefinition,
    removeExternalDefinitions,
} from 'zigbee-herdsman-converters';
import {lock_set_pin_code_response} from 'zigbee-herdsman-converters/converters/fromZigbee';
import {definitions} from 'zigbee-herdsman-converters/devices/yale';
import definition from './yale-yrd430-pin-response.mjs';

const base = definitions.find((entry) => entry.model === 'YRD430-BLE');
const original = prepareDefinition(base);
const fixed = prepareDefinition(definition);

// Use the same cluster/type selection as Z2M's receive path. No PIN data is
// needed: Set/Clear PIN responses only carry a status code.
function matchingConverters(model, type, cluster = 'closuresDoorLock') {
    return model.fromZigbee.filter((converter) =>
        converter.cluster === cluster &&
        (Array.isArray(converter.type) ? converter.type.includes(type) : converter.type === type));
}

async function convertResponse(model, type, status) {
    const converters = matchingConverters(model, type);
    assert.equal(converters.length, 1);
    return converters[0].convert(model, {type, data: {status}}, () => {}, {}, {});
}

test('reproduces the missing response converter in the shipped definition', () => {
    assert.deepEqual(base.zigbeeModel, ['YRD430 TS', 'YRD430 PB']);
    for (const type of ['commandSetPinCodeRsp', 'commandClearPinCodeRsp']) {
        assert.equal(matchingConverters(original, type).length, 0);
        assert.deepEqual(matchingConverters(fixed, type), [lock_set_pin_code_response]);
    }
});

test('preserves built-in converters, exposes, configuration and slot capacity', () => {
    assert.deepEqual(
        fixed.fromZigbee.filter((converter) => converter !== lock_set_pin_code_response),
        original.fromZigbee,
    );
    assert.deepEqual(fixed.toZigbee, original.toZigbee);
    assert.deepEqual(fixed.exposes, original.exposes);
    assert.deepEqual(fixed.meta, original.meta);
    assert.equal(fixed.meta.pinCodeCount, 250);
    assert.equal(definition.extend, base.extend);
    assert.equal(fixed.model, original.model);
    assert.equal(fixed.vendor, original.vendor);
});

test('external definition overrides both YRD430 variants and leaves other models alone', async () => {
    const name = 'yale-yrd430-pin-response.mjs';
    const external = {...definition, externalConverterName: name};
    const otherBefore = await findByDevice({modelID: 'YRD450 TS', type: 'EndDevice'});
    addExternalDefinition(external);
    try {
        for (const modelID of ['YRD430 PB', 'YRD430 TS']) {
            const selected = await findByDevice({modelID, type: 'EndDevice'});
            assert.equal(selected.externalConverterName, name);
            assert.deepEqual(matchingConverters(selected, 'commandSetPinCodeRsp'), [lock_set_pin_code_response]);
            assert.deepEqual(matchingConverters(selected, 'commandClearPinCodeRsp'), [lock_set_pin_code_response]);
        }
        const otherAfter = await findByDevice({modelID: 'YRD450 TS', type: 'EndDevice'});
        assert.equal(otherAfter.externalConverterName, undefined);
        assert.deepEqual(otherAfter.fromZigbee, otherBefore.fromZigbee);
    } finally {
        removeExternalDefinitions(name);
    }
    const restored = await findByDevice({modelID: 'YRD430 PB', type: 'EndDevice'});
    assert.equal(restored.externalConverterName, undefined);
    assert.equal(matchingConverters(restored, 'commandSetPinCodeRsp').length, 0);
});

for (const [type, field] of [
    ['commandSetPinCodeRsp', 'last_successful_pincode_save'],
    ['commandClearPinCodeRsp', 'last_successful_pincode_clear'],
]) {
    test(`${type} status 0 produces only the corresponding success timestamp`, async () => {
        const before = Date.now();
        const result = await convertResponse(fixed, type, 0);
        const after = Date.now();
        assert.deepEqual(Object.keys(result), [field]);
        assert.equal(typeof result[field], 'number');
        assert.ok(result[field] >= before && result[field] <= after);
    });

    test(`${type} failure or missing status never produces a success`, async () => {
        for (const status of [1, 2, 3, 255, undefined, null, '0']) {
            assert.equal(await convertResponse(fixed, type, status), undefined);
        }
    });
}

test('does not interpret publishes, generic responses or other clusters as PIN success', () => {
    for (const type of ['set', 'commandDefaultRsp', 'attributeReport']) {
        assert.ok(!matchingConverters(fixed, type).includes(lock_set_pin_code_response));
    }
    assert.deepEqual(matchingConverters(fixed, 'commandSetPinCodeRsp', 'genBasic'), []);
});
