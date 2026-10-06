import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../dist/src/store.js';

test('plan and status events survive replay and redact likely secrets', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    const result = store.syncProject({ project: { key: 'auth', name: 'Authentication', workspacePath: home }, tasks: [
      { key: 'schema', title: 'Add user schema', status: 'in_progress' },
      { key: 'ui', title: 'Build login UI', status: 'todo' }
    ], agent: 'codex', sessionKey: 'test' });
    assert.equal(store.state.missions[result.missionId].status, 'running');
    assert.equal(result.taskIds.schema, store.state.tasks[result.taskIds.schema].id);
    store.updateTasks({ projectId: result.projectId, updates: [
      { taskKey: 'schema', status: 'completed' },
      { taskKey: 'ui', status: 'in_progress', note: 'Bearer abcdefghijklmnopqrstuvwxyz123' }
    ], sessionKey: 'test' });
    assert.equal(store.state.tasks[result.taskIds.ui].note, '[REDACTED]');
    const replayed = new Store(); replayed.load();
    assert.deepEqual(replayed.state, store.state);
    replayed.updateTasks({ projectId: result.projectId, updates: [{ taskKey: 'ui', status: 'completed' }], sessionKey: 'test' });
    assert.equal(replayed.state.missions[result.missionId].status, 'completed');
    replayed.snapshot();
    const fromSnapshot = new Store(); fromSnapshot.load();
    assert.deepEqual(fromSnapshot.state, replayed.state);
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plan reconciliation only removes explicit task keys', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    const project = { key: 'feature', name: 'Feature', workspacePath: home };
    const result = store.syncProject({ project, tasks: [
      { key: 'a', title: 'A', status: 'completed' }, { key: 'b', title: 'B', status: 'todo' }
    ] });
    store.syncProject({ project, tasks: [{ key: 'a', title: 'A', status: 'completed' }] });
    assert.ok(store.state.tasks[result.taskIds.b]);
    store.syncProject({ project, tasks: [], removedTaskKeys: ['b'] });
    assert.equal(store.state.tasks[result.taskIds.b], undefined);
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a torn final event line is quarantined and earlier events remain usable', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    store.syncProject({ project: { key: 'safe', name: 'Safe', workspacePath: home }, tasks: [{ key: 'one', title: 'One', status: 'todo' }] });
    const log = path.join(home, 'events', `${new Date().toISOString().slice(0, 7)}.ndjson`);
    fs.appendFileSync(log, '{"seq":');
    const recovered = new Store(); recovered.load();
    assert.equal(Object.keys(recovered.state.projects).length, 1);
    assert.ok(fs.readdirSync(path.dirname(log)).some(file => file.includes('.corrupt-')));
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('different agents share a project while task attribution follows the latest reporter', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    const result = store.syncProject({ agent: 'codex', sessionKey: 'first', project: {
      key: 'shared', name: 'Shared', workspacePath: home
    }, tasks: [{ key: 'one', title: 'First task', status: 'in_progress' }] });
    store.updateTasks({ agent: 'claude', sessionKey: 'second', projectId: result.projectId,
      updates: [{ taskKey: 'one', status: 'completed' }] });
    assert.equal(store.state.tasks[result.taskIds.one].updatedBy, 'claude');
    assert.deepEqual(new Set(Object.values(store.state.sessions).map(s => s.agent)), new Set(['codex', 'claude']));
    assert.throws(() => store.syncProject({ agent: 'bad agent!', project: { name: 'Bad', workspacePath: home }, tasks: [] }), /Agent must/);
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('native session and child-agent identifiers are linked only when supplied', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    const project = { key: 'agents', name: 'Agents', workspacePath: home };
    const result = store.syncProject({ agent: 'codex', sessionKey: 'transport-one', project,
      tasks: [{ key: 'root', title: 'Root task', status: 'in_progress' }] });
    const anonymous = store.state.sessions[store.state.tasks[result.taskIds.root].updatedBySessionId];
    assert.equal(anonymous.sourceSessionId, undefined);
    assert.equal(anonymous.accountLabel, undefined);
    store.syncProject({ agent: 'codex', sessionKey: 'transport-one', sourceSessionId: 'conversation-1',
      agentId: 'root', accountLabel: 'work', project,
      tasks: [{ key: 'root', title: 'Root task', status: 'in_progress' }] });
    store.syncProject({ agent: 'codex', sessionKey: 'transport-two', sourceSessionId: 'conversation-1',
      agentId: 'root', project, tasks: [{ key: 'root', title: 'Root task', status: 'in_progress' }] });
    const root = store.state.sessions[store.state.tasks[result.taskIds.root].updatedBySessionId];
    assert.equal(root.id, anonymous.id);
    assert.equal(root.sourceSessionId, 'conversation-1');
    assert.equal(root.accountLabel, 'work');
    store.updateTasks({ agent: 'codex', sessionKey: 'transport-two', sourceSessionId: 'conversation-1',
      agentId: 'root/review', parentAgentId: 'root', projectId: result.projectId,
      updates: [{ taskKey: 'root', status: 'completed' }] });
    const child = store.state.sessions[store.state.tasks[result.taskIds.root].updatedBySessionId];
    assert.notEqual(child.id, root.id);
    assert.equal(child.parentAgentId, 'root');
    assert.equal(child.agentId, 'root/review');
    assert.throws(() => store.syncProject({ agent: 'codex', parentAgentId: 'root', project, tasks: [] }), /Agent ID is required/);
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('progress updates persist, reject invalid percentages, and reset when work reopens', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
  const prior = process.env.BEACON_HOME;
  process.env.BEACON_HOME = home;
  try {
    const store = new Store(); store.load();
    const result = store.syncProject({ agent: 'codex', sessionKey: 'progress', project: {
      key: 'progress', name: 'Progress', workspacePath: home
    }, tasks: [{ key: 'one', title: 'One', status: 'in_progress', progress: 35 },
      { key: 'unknown', title: 'Unknown', status: 'in_progress' }] });
    const update = value => store.updateTasks({ agent: 'codex', sessionKey: 'progress', projectId: result.projectId, updates: [value] });
    assert.equal(store.state.tasks[result.taskIds.unknown].progress, undefined);
    update({ taskKey: 'one', status: 'in_progress', progress: 70 });
    assert.equal(store.state.tasks[result.taskIds.one].progress, 70);
    update({ taskKey: 'one', status: 'blocked', note: 'Waiting for review' });
    assert.equal(store.state.tasks[result.taskIds.one].progress, 70);
    const before = store.view();
    for (const progress of [-1, 101, NaN, '50']) {
      assert.throws(() => update({ taskKey: 'one', status: 'in_progress', progress }), /Progress must/);
      assert.deepEqual(store.state, before);
    }
    update({ taskKey: 'one', status: 'completed' });
    assert.equal(store.state.tasks[result.taskIds.one].progress, 100);
    update({ taskKey: 'one', status: 'in_progress' });
    assert.equal(store.state.tasks[result.taskIds.one].progress, undefined);
    const replayed = new Store(); replayed.load();
    assert.deepEqual(replayed.state, store.state);
  } finally {
    if (prior === undefined) delete process.env.BEACON_HOME; else process.env.BEACON_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
