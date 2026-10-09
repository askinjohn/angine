import test from 'node:test';
import assert from 'node:assert/strict';
import { isAngineDaemonCommand } from '../dist/src/ipc.js';

test('legacy restart recognises only the matching Node Angine daemon', () => {
  const bin = '/Users/user/Projects/angine/dist/bin/angine.js';
  assert.equal(isAngineDaemonCommand(`node ${bin} daemon`,bin),true);
  assert.equal(isAngineDaemonCommand(`/opt/homebrew/bin/node ${bin} daemon\n`,bin),true);
  assert.equal(isAngineDaemonCommand(`node /other/angine.js daemon`,bin),false);
  assert.equal(isAngineDaemonCommand(`node ${bin} mcp`,bin),false);
  assert.equal(isAngineDaemonCommand(`sh ${bin} daemon`,bin),false);
  assert.equal(isAngineDaemonCommand(`node ${bin} daemon --extra`,bin),false);
});
