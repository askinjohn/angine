import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReporterIdentity } from '../dist/src/identity.js';

test('Codex identity uses runtime identifiers and never fabricates a native session', () => {
  assert.deepEqual(nativeReporterIdentity('codex', {}), {});
  assert.deepEqual(nativeReporterIdentity('codex', { CODEX_THREAD_ID: 'thread-1', CODEX_SESSION_ID: 'session-1' }), { sourceSessionId: 'thread-1' });
  assert.deepEqual(nativeReporterIdentity('codex', { CODEX_SESSION_ID: 'session-1' }), { sourceSessionId: 'session-1' });
  assert.deepEqual(nativeReporterIdentity('claude', { CODEX_THREAD_ID: 'thread-1' }), {});
  assert.deepEqual(nativeReporterIdentity('codex', { CODEX_THREAD_ID: 'Bearer abcdefghijklmnopqrstuvwxyz123' }), {});
});
