# Yale Assure lock 2 PIN response companion fix

For Zigbee2MQTT 2.14.2 and its pinned `zigbee-herdsman-converters` 26.115.1.
This companion runs in Zigbee2MQTT. HACS only installs the Home Assistant
integration and will not install it.

## Confirmed cause

The built-in Yale `YRD430-BLE` definition matches model IDs `YRD430 PB` and
`YRD430 TS`. Its shared `lockExtend()` includes PIN read and programming-event
converters, but omits `fz.lock_set_pin_code_response`. Successful
`closuresDoorLock.commandSetPinCodeRsp` and `commandClearPinCodeRsp` messages
therefore have no converter. Lockly cannot recognize a response that Zigbee2MQTT
does not publish to MQTT.

The external converter imports the installed Yale definition and adds that
existing response converter. Lock state, battery, events, PIN commands, exposes,
reporting configuration, and the slot count remain as provided by Zigbee2MQTT.
Only the two YRD430 model IDs are affected.

The generic converter returns `last_successful_pincode_save` or
`last_successful_pincode_clear` in epoch milliseconds only when the corresponding
Zigbee response has numeric `status: 0`. Failure responses produce no success
timestamp. It does not read PINs, expose PIN values, infer success from publishing,
or parse debug logs.

Source references:

- [Zigbee2MQTT 2.14.2 dependency pins](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/package.json)
- [Pinned Yale definition and lockExtend](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/devices/yale.ts)
- [Pinned generic PIN response converter](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/converters/fromZigbee.ts)

## Operator installation

1. Keep Lockly fork commit `6fb004a` or a later build containing its timestamp
   handler. No further Home Assistant runtime change is required for this fix.
2. Back up Zigbee2MQTT's configuration and existing external converters.
3. Check Zigbee2MQTT's `advanced.enable_external_js`. If disabled, enable it in
   Zigbee2MQTT's configuration and restart Zigbee2MQTT when ready:

   ```yaml
   advanced:
     enable_external_js: true
   ```

   Merge this into the existing `advanced` mapping. Do not replace other settings.
4. In the Zigbee2MQTT frontend, open **Settings > Dev console > External
   converters**. Save the contents of
   [yale-yrd430-pin-response.mjs](yale-yrd430-pin-response.mjs) using exactly that
   filename. Zigbee2MQTT loads converters saved through this interface at runtime.
   Confirm that it appears in the loaded converter list without a load error.
5. Alternatively, copy only `yale-yrd430-pin-response.mjs` into
   `external_converters/` beside Zigbee2MQTT's own `configuration.yaml`, then
   restart Zigbee2MQTT. For a typical HA add-on data path this is
   `/config/zigbee2mqtt/external_converters/yale-yrd430-pin-response.mjs`; confirm
   the add-on's configured data path first. Do not copy the test file, package
   files, or `node_modules` into this folder.

The external definition takes priority over the built-in model. Re-pairing the
lock, reading PINs, and restarting Home Assistant are unnecessary. An existing
converter for these same model IDs should be reviewed before adding a second
override.

See [Zigbee2MQTT's external-converter instructions](https://www.zigbee2mqtt.io/advanced/more/external_converters.html)
for loading, listing, and removing converters.

## Verification and limits

No live installation, restart, or PIN operation was performed while preparing
this artifact. No more apply actions are needed for the completed capture. The
previous timeout stays a timeout; loading a converter cannot recover an earlier
response that was discarded.

On the next separately authorized PIN operation, verify this sequence:

1. The lock sends its successful set or clear response.
2. The device's JSON MQTT state topic, for example
   `zigbee2mqtt/Front Door Lock`, gains a fresh matching
   `last_successful_pincode_save` or `last_successful_pincode_clear` value.
3. Lockly clears `Updating` without another retry. All selected locks must settle
   before a multi-lock slot finishes.

Inspect only the two acknowledgment fields and slot status. Do not retain whole
device payloads or `/set` messages, which can contain PINs. Debug logging is not
required. Physically testing the keypad is a separate check of the installed PIN.

Lockly compares these timestamps against its request start time and rejects
cached duplicates. The Home Assistant and Zigbee2MQTT hosts should have
synchronized clocks. The Zigbee response contains no slot ID; Lockly associates
it with its single published request for that lock. Avoid concurrent PIN
programming through another controller during a later verification.

## Rollback and upstream fix

Remove this filename through the Zigbee2MQTT external-converter interface to
restore the built-in definition at runtime. For file-based removal, remove the
file and restart Zigbee2MQTT. Restore `enable_external_js` to its previous value
if it was changed solely for this test. This does not undo any PIN programming.

[yale-yrd430-upstream.patch](yale-yrd430-upstream.patch) adds the same converter
directly to the YRD430 definition in `zigbee-herdsman-converters`. It applies to
tag `v26.115.1`; it has not been submitted upstream. Once Zigbee2MQTT includes an
upstream fix, remove the external override before using the built-in fix.

## Offline tests

From this directory with Node.js 22.2 or later supported by Zigbee2MQTT:

```sh
npm ci --ignore-scripts
npm test
```

The dependency lock pins the converter and herdsman versions shipped with
Zigbee2MQTT 2.14.2. Tests reproduce the missing converter, register the external
definition through the real library, verify both YRD430 variants and rollback,
preserve the original model behavior, check set/clear success timestamps, and
reject unsuccessful responses and unrelated messages. They use only synthetic
status responses, without PIN values or a live broker.
