// Antigravity Web UI - Device Adapter Module Entry Point

const { DeviceAdapter } = require('./base');
const { AndroidDeviceAdapter } = require('./android_adapter');
const { AppRegistry } = require('./app_registry');
const { createActionResult } = require('./types');

let defaultAdapterInstance = null;

function getDeviceAdapter() {
  if (!defaultAdapterInstance) {
    defaultAdapterInstance = new AndroidDeviceAdapter();
  }
  return defaultAdapterInstance;
}

module.exports = {
  getDeviceAdapter,
  DeviceAdapter,
  AndroidDeviceAdapter,
  AppRegistry,
  createActionResult
};
