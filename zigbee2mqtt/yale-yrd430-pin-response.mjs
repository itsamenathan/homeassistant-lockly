// Companion fix for Zigbee2MQTT 2.14.2 / zigbee-herdsman-converters 26.115.1.
// Keep the built-in Yale behavior and add its missing PIN write acknowledgment.
import {lock_set_pin_code_response} from 'zigbee-herdsman-converters/converters/fromZigbee';
import {definitions} from 'zigbee-herdsman-converters/devices/yale';

const yale = definitions.find((definition) => definition.model === 'YRD430-BLE');
if (!yale) {
    throw new Error('Built-in Yale YRD430-BLE definition not found; check converter compatibility');
}

export default {
    ...yale,
    fromZigbee: [...(yale.fromZigbee ?? []), lock_set_pin_code_response],
};
