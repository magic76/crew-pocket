'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdbTargetConnected } = require('../lib/adb-status');

test('exact local endpoint must be authorized', () => {
  assert.equal(isAdbTargetConnected('List of devices attached\n127.0.0.1:37895 device product:S23\n', '127.0.0.1:37895'), true);
  assert.equal(isAdbTargetConnected('List of devices attached\n127.0.0.1:37896 device\n', '127.0.0.1:37895'), false);
});

test('offline or unauthorized endpoint is never a connected device', () => {
  const devices = 'List of devices attached\n127.0.0.1:37895 offline\n127.0.0.1:38000 device\n';
  assert.equal(isAdbTargetConnected(devices, '127.0.0.1:37895'), false);
  assert.equal(isAdbTargetConnected('127.0.0.1:37895 unauthorized\n', '127.0.0.1:37895'), false);
  assert.equal(isAdbTargetConnected(devices, '127.0.0.1:38000'), true);
});

test('without a chosen target only an authorized entry counts', () => {
  assert.equal(isAdbTargetConnected('List of devices attached\n'), false);
  assert.equal(isAdbTargetConnected('List of devices attached\n127.0.0.1:37532 offline\n'), false);
  assert.equal(isAdbTargetConnected('List of devices attached\n127.0.0.1:37532 device\n'), true);
});
