'use strict';

/** Match exact ADB serial and state; 'offline' must never appear as connected. */
function isAdbTargetConnected(devicesOutput, target = '') {
  const expected = String(target || '').trim();
  return String(devicesOutput || '')
    .split(/\r?\n/)
    .some(line => {
      const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)(?:\s|$)/);
      return Boolean(match && match[2] === 'device' && (!expected || match[1] === expected));
    });
}

module.exports = { isAdbTargetConnected };
