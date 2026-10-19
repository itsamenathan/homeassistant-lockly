"""Tests for persisted Lockly slot recovery."""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.helpers.storage import Store
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.lockly.const import (
    DOMAIN,
    LOGGER,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from custom_components.lockly.coordinator import LocklySlot, LocklySlotCoordinator

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant


@pytest.mark.parametrize(
    ("busy", "status"),
    [
        (True, "updating"),
        (True, "queued"),
        (True, ""),
        (True, "timeout"),
        (False, "updating"),
        (False, "queued"),
    ],
)
async def test_load_recovers_interrupted_slots(
    hass: HomeAssistant, *, busy: bool, status: str
) -> None:
    """Startup clears orphaned work without claiming success or losing history."""
    stored_slot = LocklySlot(
        slot=20,
        name="Interrupted guest",
        pin="synthetic-test-data",
        enabled=True,
        busy=busy,
        status=status,
        last_response={"lock": "Front Door Lock", "status": "timeout", "attempts": 4},
        last_response_ts=1234567890.0,
    )
    store = AsyncMock(spec=Store)
    store.async_load.return_value = [asdict(stored_slot)]
    coordinator = LocklySlotCoordinator(
        hass, store, MockConfigEntry(domain=DOMAIN, title="Lockly"), LOGGER
    )

    await coordinator.async_load()

    expected = {**asdict(stored_slot), "busy": False, "status": "timeout"}
    assert asdict(coordinator.data[20]) == expected
    store.async_save.assert_awaited_once_with([expected])

    # Reloading the normalized record must leave the prior response intact and
    # must not write again when there is no longer an interrupted operation.
    store.async_load.return_value = [expected]
    store.async_save.reset_mock()
    await coordinator.async_load()
    assert asdict(coordinator.data[20]) == expected
    store.async_save.assert_not_awaited()


@pytest.mark.parametrize("status", ["", "timeout"])
async def test_load_preserves_settled_slots(hass: HomeAssistant, status: str) -> None:
    """A completed or timed-out slot must keep its saved response and state."""
    slot = LocklySlot(
        slot=21,
        name="Settled guest",
        enabled=True,
        status=status,
        last_response={"status": "enabled" if not status else "timeout"},
        last_response_ts=1234567891.0,
    )
    store = AsyncMock(spec=Store)
    store.async_load.return_value = [asdict(slot)]
    coordinator = LocklySlotCoordinator(
        hass, store, MockConfigEntry(domain=DOMAIN, title="Lockly"), LOGGER
    )

    await coordinator.async_load()

    assert asdict(coordinator.data[21]) == asdict(slot)
    store.async_save.assert_not_awaited()


@pytest.mark.enable_socket
async def test_startup_recovers_sensor_without_mqtt_publish(
    hass: HomeAssistant, hass_storage: dict, enable_custom_integrations: Any
) -> None:
    """Full setup exposes a retryable slot without sending any lock commands."""
    hass.data["lockly_skip_frontend"] = True
    hass.data["lockly_skip_mqtt"] = True
    entry = MockConfigEntry(domain=DOMAIN, title="Lockly", data={})
    entry.add_to_hass(hass)
    key = f"{STORAGE_KEY}.{entry.entry_id}"
    interrupted = LocklySlot(slot=20, enabled=True, busy=True, status="updating")
    completed = LocklySlot(
        slot=21,
        enabled=True,
        last_response={"action": "pin_code_added", "status": "enabled"},
        last_response_ts=1234567891.0,
    )
    hass_storage[key] = {
        "version": STORAGE_VERSION,
        "key": key,
        "data": [asdict(interrupted), asdict(completed)],
    }
    mqtt_calls = async_mock_service(hass, "mqtt", "publish")

    await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    manager = entry.runtime_data.manager
    assert manager.coordinator.data[20].busy is False
    assert manager.coordinator.data[20].status == "timeout"
    assert asdict(manager.coordinator.data[21]) == asdict(completed)
    sensor = next(
        state
        for state in hass.states.async_all("sensor")
        if state.attributes.get("lockly_slot") == 20
    )
    assert sensor.attributes["busy"] is False
    assert sensor.attributes["status"] == "timeout"
    assert hass_storage[key]["data"][0]["busy"] is False
    assert hass_storage[key]["data"][0]["status"] == "timeout"
    assert mqtt_calls == []
