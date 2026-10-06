import test from 'node:test';
import assert from 'node:assert/strict';
import { isBeaconDaemonCommand } from '../dist/src/ipc.js';

test('legacy restart recognises only the matching Node Beacon daemon', () => {
  const bin = '/Users/user/Projects/beacon/dist/bin/beacon.js';
  assert.equal(isBeaconDaemonCommand(`node ${bin} daemon`,bin),true);
  assert.equal(isBeaconDaemonCommand(`/opt/homebrew/bin/node ${bin} daemon\n`,bin),true);
  assert.equal(isBeaconDaemonCommand(`node /other/beacon.js daemon`,bin),false);
  assert.equal(isBeaconDaemonCommand(`node ${bin} mcp`,bin),false);
  assert.equal(isBeaconDaemonCommand(`sh ${bin} daemon`,bin),false);
  assert.equal(isBeaconDaemonCommand(`node ${bin} daemon --extra`,bin),false);
});
