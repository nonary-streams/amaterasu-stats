import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const context=vm.createContext({Error,TextEncoder});
for (const source of ['src/adapter.ts','src/history.ts','src/history_settings.ts']) {vm.runInContext(ts.transpile(readFileSync(source,'utf8'),{target:ts.ScriptTarget.ES2022}),context);vm.runInContext('Object.assign(globalThis, Amaterasu)',context);}
const ordinary=value=>JSON.parse(JSON.stringify(value));


test("history editor confirms exact signed revision and settings readback", async () => {
  const current = { ok: true, revision: 4, settings: { enabled: true, ttl_days: 30, db_size_limit_mb: 50 }, effective_enabled: true };
  const calls = [];
  const saved = { ...current, revision: 5, settings: { enabled: false, ttl_days: 14, db_size_limit_mb: 20 }, effective_enabled: true };
  const api = { async post(route, body) {
    calls.push([route, ordinary(body ?? {})]);
    return saved;
  } };
  assert.deepEqual(ordinary(await context.Amaterasu.saveHistorySettings(api, current, false, 14, 20)), saved);
  assert.deepEqual(calls, [
    ["history/settings_update", { settings: saved.settings, expected_revision: 4 }],
    ["history/settings_get", {}],
  ]);
  for (const stale of [current, { ...saved, revision: 6 }, { ...saved, settings: { ...saved.settings, ttl_days: 15 } }]) {
    const staleApi = { async post(route) { return route === "history/settings_get" ? stale : saved; } };
    await assert.rejects(context.Amaterasu.saveHistorySettings(staleApi, current, false, 14, 20), /could not be confirmed/);
  }
  for (const rejected of [
    { ok: false, code: "revision_conflict", revision: 5 },
    { ok: false, code: "write_unresolved" },
    { ...saved, revision: 6 },
    { ...saved, settings: { ...saved.settings, ttl_days: 15 } },
  ]) {
    const routes = [];
    const rejectedApi = { async post(route) {
      routes.push(route);
      return rejected;
    } };
    await assert.rejects(context.Amaterasu.saveHistorySettings(rejectedApi, current, false, 14, 20));
    assert.deepEqual(routes, ["history/settings_update"]);
  }
});


test("history editor ignores stale loads and errors after a newer load or save begins", async () => {
  const gate = new context.Amaterasu.HistorySettingsLoadGate();
  const replies = [];
  const api = { post(route) {
    assert.equal(route, "history/settings_get");
    return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  } };
  const old = gate.read(api);
  const latest = gate.read(api);
  const current = { ok: true, revision: 8, settings: { enabled: true, ttl_days: 14, db_size_limit_mb: 20 }, effective_enabled: true };
  replies[1].resolve(current);
  assert.equal((await latest).settings.revision, 8);
  replies[0].resolve({ ...current, revision: 7 });
  assert.equal(await old, null);

  const duringSave = gate.read(api);
  gate.invalidate();
  replies[2].reject(new Error("outdated request failed"));
  assert.equal(await duringSave, null);

  const reloaded = gate.read(api);
  replies[3].resolve({ ...current, revision: 9 });
  assert.equal((await reloaded).settings.revision, 9);
});


test("history editor discards an older runtime status after refresh", async () => {
  const gate = new context.Amaterasu.HistorySettingsLoadGate();
  const current = { ok: true, revision: 9,
    settings: { enabled: true, ttl_days: 14, db_size_limit_mb: 20 }, effective_enabled: true };
  const runtime = { ok: true, status: {
    available: true, configuration_ready: true, applied_revision: 9,
    enabled: true, effective_enabled: true, degraded: false,
    failed_operations: 0, active_streams: 0, pending_activities: 0,
    sessions: 0, samples: 0, events: 0, live_bytes: 0,
    last_prune: { sessions_deleted: 0, live_bytes: 0,
      size_limit_bytes: 0, size_limit_unmet: false },
  } };
  const pending = [];
  const api = { post(route) {
    if (route === "history/settings_get") return Promise.resolve(current);
    return new Promise((resolve) => pending.push(resolve));
  } };
  const old = gate.read(api);
  await new Promise(setImmediate);
  const latest = gate.read(api);
  await new Promise(setImmediate);
  pending[1](runtime);
  assert.equal((await latest).runtime.applied_revision, 9);
  pending[0]({ ...runtime, status: { ...runtime.status, applied_revision: 8 } });
  assert.equal(await old, null);
});


test("history editor confirms deferred toggles and durable restart readback", async () => {
  let stored = { ok: true, revision: 4, settings: { enabled: false, ttl_days: 30, db_size_limit_mb: 50 }, effective_enabled: false };
  let runtime = {
    ok: true,
    status: {
      available: true, configuration_ready: true, applied_revision: 4,
      enabled: false, effective_enabled: false,
      degraded: false, failed_operations: 0, active_streams: 1, pending_activities: 0, sessions: 0, samples: 0,
      events: 0, live_bytes: 0,
      last_prune: { sessions_deleted: 0, live_bytes: 0, size_limit_bytes: 0, size_limit_unmet: false },
    },
  };
  const calls = [];
  const api = { async post(route, body) {
    calls.push([route, ordinary(body ?? {})]);
    if (route === "history/settings_update") {
      assert.equal(body.expected_revision, stored.revision);
      const effective = runtime.status.active_streams === 0
        ? body.settings.enabled : runtime.status.effective_enabled;
      stored = { ...stored, revision: stored.revision + 1, settings: body.settings,
        effective_enabled: effective };
      runtime = { ...runtime, status: { ...runtime.status, enabled: body.settings.enabled,
        applied_revision: runtime.status.active_streams === 0 && runtime.status.pending_activities === 0
          ? stored.revision : runtime.status.applied_revision,
        effective_enabled: effective,
        last_prune: { ...runtime.status.last_prune,
          size_limit_bytes: body.settings.db_size_limit_mb * 1048576 } } };
      return stored;
    }
    return route === "history/settings_get" ? stored : runtime;
  } };
  assert.equal(context.Amaterasu.parseHistoryRuntimeStatus(runtime).available, true);
  const initial = await context.Amaterasu.readHistorySettingsState(api);
  assert.deepEqual(calls, [["history/settings_get", {}], ["history/history_status", {}]]);
  assert.equal(initial.runtime?.available, true);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(initial.settings, initial.runtime), /Recording is disabled for new streams/);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(initial.settings, initial.runtime), /Automatic retention and deletion are paused/);
  const saved = await context.Amaterasu.saveHistorySettingsState(api, initial.settings, true, 14, 20);
  assert.equal(saved.settings.revision, 5);
  assert.equal(saved.settings.effective_enabled, false);
  assert.equal(saved.runtime.effective_enabled, false);
  assert.equal(saved.runtime.applied_revision, 4);
  const deferredStatus = context.Amaterasu.historySettingsRuntimeDescription(saved.settings, saved.runtime);
  assert.match(deferredStatus, /Runtime status is stale: applied revision 4 is behind/);
  assert.doesNotMatch(deferredStatus, /Runtime applied revision 5 confirmed/);
  assert.equal(saved.runtime.last_prune.size_limit_bytes, 20 * 1048576);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(saved.settings, saved.runtime), /enable is deferred until active streams end; new streams still use the disabled policy/);
  runtime = { ...runtime, status: { ...runtime.status, active_streams: 0, pending_activities: 1 } };
  const pendingLaunch = context.Amaterasu.historySettingsRuntimeDescription(saved.settings,
    context.Amaterasu.parseHistoryRuntimeStatus(runtime));
  assert.match(pendingLaunch, /enable is deferred until 1 pending launch resolves/);
  assert.match(pendingLaunch, /0 active streams · 1 pending launch/);
  assert.doesNotMatch(pendingLaunch, /new streams/);
  runtime = { ...runtime, status: { ...runtime.status, active_streams: 1, pending_activities: 0 } };
  assert.deepEqual(calls.map(([route]) => route), [
    "history/settings_get", "history/history_status", "history/settings_update",
    "history/settings_get", "history/history_status",
  ]);
  // A newly started stream joins the old cohort and does not apply the saved toggle.
  runtime = { ...runtime, status: { ...runtime.status, active_streams: 2 } };
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(saved.settings,
    context.Amaterasu.parseHistoryRuntimeStatus(runtime)), /still use the disabled policy/);
  runtime = { ...runtime, status: { ...runtime.status, effective_enabled: true,
    applied_revision: 5, active_streams: 0 } };
  stored = { ...stored, effective_enabled: true };
  const reloaded = await context.Amaterasu.readHistorySettingsState(api);
  assert.equal(reloaded.settings.effective_enabled, true);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings, reloaded.runtime), /Recording is enabled for new streams/);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings, reloaded.runtime), /Runtime applied revision 5 confirmed/);
  const staleReadback = context.Amaterasu.historySettingsRuntimeDescription(initial.settings, reloaded.runtime);
  assert.match(staleReadback, /settings readback is stale/);
  assert.doesNotMatch(staleReadback, /Runtime applied revision 5 confirmed|Recording is enabled for new streams/);
  const unconfirmed = context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings,
    { ...reloaded.runtime, applied_revision: null });
  assert.match(unconfirmed, /Runtime applied revision is unavailable/);
  assert.doesNotMatch(unconfirmed, /Recording is enabled for new streams/);
  assert.doesNotMatch(context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings, reloaded.runtime), /retention and deletion are paused/);
  runtime = { ...runtime, status: { ...runtime.status, active_streams: 1 } };
  const disabled = await context.Amaterasu.saveHistorySettingsState(api, reloaded.settings, false, 7, 10);
  assert.equal(disabled.settings.revision, 6);
  assert.equal(disabled.settings.effective_enabled, true);
  assert.equal(disabled.runtime.last_prune.size_limit_bytes, 10 * 1048576);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(disabled.settings, disabled.runtime), /disable is deferred until active streams end; new streams still use the enabled policy/);
  runtime = { ...runtime, status: { ...runtime.status, active_streams: 2 } };
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(disabled.settings,
    context.Amaterasu.parseHistoryRuntimeStatus(runtime)), /still use the enabled policy/);
  runtime = { ...runtime, status: { ...runtime.status, effective_enabled: false,
    applied_revision: 6, active_streams: 0 } };
  stored = { ...stored, effective_enabled: false };
  const drained = await context.Amaterasu.readHistorySettingsState(api);
  assert.equal(drained.settings.effective_enabled, false);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(drained.settings, drained.runtime), /Recording is disabled for new streams/);
  const retention = await context.Amaterasu.saveHistorySettingsState(api, drained.settings, false, 3, 5);
  assert.equal(retention.settings.revision, 7);
  assert.equal(retention.settings.effective_enabled, false);
  assert.equal(retention.runtime.last_prune.size_limit_bytes, 5 * 1048576);
  assert.deepEqual(calls.filter(([route]) => route === "history/settings_update"), [
    ["history/settings_update", { settings: { enabled: true, ttl_days: 14, db_size_limit_mb: 20 }, expected_revision: 4 }],
    ["history/settings_update", { settings: { enabled: false, ttl_days: 7, db_size_limit_mb: 10 }, expected_revision: 5 }],
    ["history/settings_update", { settings: { enabled: false, ttl_days: 3, db_size_limit_mb: 5 }, expected_revision: 6 }],
  ]);
  runtime = { ...runtime, status: { ...runtime.status, enabled: true } };
  const mismatch = await context.Amaterasu.readHistorySettingsState(api);
  const mismatchDescription = context.Amaterasu.historySettingsRuntimeDescription(mismatch.settings, mismatch.runtime);
  assert.match(mismatchDescription, /different recording policy from this saved readback; refresh to check the current settings/);
  assert.doesNotMatch(mismatchDescription, /not yet|pending|deferred/);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings, disabled.runtime),
    /different recording policy from this saved readback/);
  runtime = { ...runtime, status: { ...runtime.status, enabled: true } };
  const notReady = context.Amaterasu.historySettingsRuntimeDescription(reloaded.settings, {
    ...reloaded.runtime, configuration_ready: false,
  });
  assert.match(notReady, /configuration is not ready/);
  runtime = { ...runtime, status: { ...runtime.status, available: false, effective_enabled: false } };
  const unavailable = await context.Amaterasu.readHistorySettingsState(api);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(unavailable.settings, unavailable.runtime), /storage is unavailable/);
  assert.doesNotMatch(context.Amaterasu.historySettingsRuntimeDescription(unavailable.settings, unavailable.runtime), /Recording is enabled for new streams/);
  runtime = { ...runtime, status: { ...runtime.status, available: true, enabled: false, degraded: true } };
  const degraded = await context.Amaterasu.readHistorySettingsState(api);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(degraded.settings, degraded.runtime), /degraded/);
  assert.doesNotMatch(context.Amaterasu.historySettingsRuntimeDescription(degraded.settings, degraded.runtime), /writes are healthy|successfully recorded/);
  runtime = { ...runtime, status: { ...runtime.status, available: "true" } };
  const malformed = await context.Amaterasu.readHistorySettingsState(api);
  assert.equal(malformed.runtime, null);
  assert.match(context.Amaterasu.historySettingsRuntimeDescription(malformed.settings, malformed.runtime), /status is unavailable/);
  const rejected = await context.Amaterasu.readHistorySettingsState({ async post(route) {
    if (route === "history/history_status") throw new Error("service unavailable");
    return stored;
  } });
  assert.equal(rejected.runtime, null);
});


test("history form keeps retention controls visible and saves them while recording is disabled", async () => {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.isConnected = false;
      this.value = "";
    }
    setConnected(value) {
      this.isConnected = value;
      for (const child of this.children) child?.setConnected?.(value);
    }
    append(...children) {
      for (const child of children) {
        if (child == null) continue;
        this.children.push(child);
        child?.setConnected?.(this.isConnected);
      }
    }
    replaceChildren(...children) {
      for (const child of this.children) child?.setConnected?.(false);
      this.children = [];
      this.append(...children);
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    setAttribute() {}
    reportValidity() { return true; }
    get valueAsNumber() { return Number(this.value); }
    get textContent() {
      return this.children.map((child) => typeof child === "string" ? child : child.textContent).join("");
    }
    set textContent(value) { this.replaceChildren(value); }
    fire(name, event) { this.listeners.get(name)?.(event); }
  }
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      if (typeof child === "string") continue;
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  };
  const dom = vm.createContext({ TextEncoder, URL, Error,
    document: { createElement: (name) => new Element(name) } });
  for (const source of ["src/adapter.ts", "src/history.ts", "src/history_settings.ts"]) {
    vm.runInContext(ts.transpile(readFileSync(source, "utf8"), { target: ts.ScriptTarget.ES2022 }), dom);
    vm.runInContext("Object.assign(globalThis, Amaterasu)", dom);
    vm.runInContext("globalThis.renderExtensionSlot = () => {}; globalThis.renderHostMetricsDashboard = () => {}; globalThis.renderSystemTraySettings = () => {};", dom);
  }
  dom.ApiError = class ApiError extends Error {};
  const content = new Element("main");
  content.setConnected(true);
  let stored = { ok: true, revision: 4,
    settings: { enabled: false, ttl_days: 30, db_size_limit_mb: 50 }, effective_enabled: false };
  const updates = [];
  dom.Amaterasu.renderHistorySettings({ content, notify() {}, api: {
    allows: (scope) => scope === "configuration.write",
    async post(route, body) {
      if (route === "history/settings_get") return stored;
      if (route === "history/history_status") throw new Error("status unavailable");
      if (route === "history/settings_update") {
        updates.push(ordinary(body));
        stored = { ...stored, revision: stored.revision + 1, settings: body.settings };
        return stored;
      }
      throw new Error(`unavailable: ${route}`);
    },
  } }, content);
  await new Promise(setImmediate);
  const historyArea = content;
  const form = find(historyArea, (node) => node.tagName === "form");
  assert.ok(form);
  const enabled = find(form, (node) => node.name === "session_history_enabled");
  const ttl = find(form, (node) => node.name === "session_history_ttl_days");
  const size = find(form, (node) => node.name === "session_history_db_size_limit_mb");
  assert.equal(enabled.checked, false);
  for (const control of [ttl, size]) {
    assert.ok(control);
    assert.equal(control.required, true);
    assert.notEqual(find(form, (node) => node.children?.includes(control)).hidden, true);
  }
  enabled.checked = true;
  enabled.fire("change");
  enabled.checked = false;
  enabled.fire("change");
  assert.notEqual(find(form, (node) => node.children?.includes(ttl)).hidden, true);
  assert.notEqual(find(form, (node) => node.children?.includes(size)).hidden, true);
  assert.match(form.textContent, /Recording changes wait for active streams to end and pending launches to resolve/);
  assert.match(form.textContent, /automatic pruning and deletion resume only after recording is enabled/);
  ttl.value = "7";
  size.value = "10";
  form.fire("submit", { preventDefault() {} });
  await new Promise(setImmediate);
  assert.deepEqual(updates, [{ settings: { enabled: false, ttl_days: 7, db_size_limit_mb: 10 }, expected_revision: 4 }]);
  assert.equal(stored.revision, 5);
  assert.equal(find(historyArea, (node) => node.name === "session_history_ttl_days").value, "7");
});


test("history settings preserve disabled pruning and enforce host integer bounds", () => {
  const parseHistory = context.Amaterasu.parseHistorySettings;
  assert.deepEqual(ordinary(parseHistory(true, 0, 0)), {
    enabled: true,
    ttl_days: 0,
    db_size_limit_mb: 0,
  });
  assert.deepEqual(ordinary(parseHistory(false, 0x7fff_ffff, 1)), {
    enabled: false,
    ttl_days: 0x7fff_ffff,
    db_size_limit_mb: 1,
  });
  for (const values of [
    ["true", 0, 0],
    [true, -1, 0],
    [true, 1.5, 0],
    [true, Number.NaN, 0],
    [true, 0x8000_0000, 0],
    [true, 0, -1],
    [true, 0, 1.5],
    [true, 0, 0x8000_0000],
  ]) {
    assert.throws(() => parseHistory(...values));
  }
});


test("session history readback validates metadata and preserves configured and effective state", () => {
  const parseReply = context.Amaterasu.parseHistorySettingsReply;
  const deferredDisable = {
    ok: true,
    settings: { enabled: false, ttl_days: 0, db_size_limit_mb: 0 },
    revision: 0,
    effective_enabled: true,
  };
  assert.deepEqual(ordinary(parseReply(deferredDisable)), deferredDisable);

  const disabled = {
    ok: true,
    settings: { enabled: false, ttl_days: 2147483647, db_size_limit_mb: 0 },
    revision: 42,
    effective_enabled: false,
  };
  assert.deepEqual(ordinary(parseReply(disabled)), disabled);

  for (const invalid of [
    null,
    undefined,
    [],
    false,
    { ...deferredDisable, ok: false },
    { ...deferredDisable, ok: "true" },
    { ...deferredDisable, settings: null },
    { ...deferredDisable, settings: [] },
    { ...deferredDisable, settings: { ...deferredDisable.settings, enabled: "false" } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, ttl_days: -1 } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, ttl_days: 1.5 } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, ttl_days: 2147483648 } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, db_size_limit_mb: "0" } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, db_size_limit_mb: -1 } },
    { ...deferredDisable, settings: { ...deferredDisable.settings, db_size_limit_mb: 2147483648 } },
    { ...deferredDisable, revision: -1 },
    { ...deferredDisable, revision: 1.5 },
    { ...deferredDisable, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...deferredDisable, revision: "0" },
    { ...deferredDisable, effective_enabled: "true" },
  ]) {
    assert.throws(() => parseReply(invalid));
  }
});