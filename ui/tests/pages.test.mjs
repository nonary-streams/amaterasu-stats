import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.isConnected = false;
  }

  setConnected(connected) {
    this.isConnected = connected;
    for (const child of this.children) child?.setConnected?.(connected);
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

  hasChildNodes() {
    return this.children.length > 0;
  }

  addEventListener(event, listener) {
    this.listeners.set(event, listener);
  }

  setAttribute(name, value) { this.attributes.set(name, value); }

  click() {
    this.listeners.get("click")?.();
  }

  get textContent() {
    return this.children
      .map((child) =>
        typeof child === "string" ? child : child?.textContent ?? "",
      )
      .join("");
  }

  set textContent(value) {
    this.replaceChildren(String(value));
  }
}

const pageTestContext = createPageContext();
for (const source of ["src/types.ts", "src/adapter.ts", "src/session_history.ts", "src/session_timeline.ts", "src/live_streams.ts", "src/history.ts"]) {
  vm.runInContext(
    ts.transpile(readFileSync(source, "utf8"), {
      target: ts.ScriptTarget.ES2022,
    }),
    pageTestContext,
  );
  if (source === "src/adapter.ts") {
    vm.runInContext(
      "Object.assign(globalThis, Amaterasu); globalThis.renderHostMetricsDashboard = () => {}; globalThis.renderHostLogs = () => {}; Amaterasu.renderManagedStreamControls = () => {}",
      pageTestContext,
    );
  }
  if (source === "src/session_history.ts" || source === "src/session_timeline.ts") vm.runInContext("Object.assign(globalThis, Amaterasu)", pageTestContext);
}

function createPageContext() {
  const timers = new Map();
  const visibilityListeners = new Set();
  const observers = new Set();
  let nextTimer = 0;
  return vm.createContext({
    document: {
      body: {},
      visibilityState: "visible",
      createElement: (tagName) => new FakeElement(tagName),
      createElementNS: (_namespace, tagName) => new FakeElement(tagName),
      createTextNode: (text) => text,
      addEventListener: (_event, listener) => visibilityListeners.add(listener),
      removeEventListener: (_event, listener) => visibilityListeners.delete(listener),
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    window: {
      setTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    timers,
    visibilityListeners,
    observers,
    Error,
    TextEncoder,
  });
}

const pages = pageTestContext.Amaterasu;

test("history runtime status reports readiness, deferred settings, failures and retention", () => {
  const parse = pages.parseHistoryRuntimeStatus;
  const describe = (reply) => pages.historyRuntimeDescription(parse(reply)).join(" ");
  assert.match(describe(historyStatus()), /Recording is enabled for new streams/);
  assert.match(describe(historyStatus()), /4 stored sessions/);
  assert.match(describe(historyStatus()), /deleted 2 sessions/);
  assert.match(describe(historyStatus({ enabled: false, effective_enabled: true })), /disable is deferred until active streams end; new streams still use the enabled policy/);
  assert.match(describe(historyStatus({ enabled: true, effective_enabled: false })), /enable is deferred until active streams end; new streams still use the disabled policy/);
  const waitingEnable = describe(historyStatus({ enabled: true, effective_enabled: false,
    active_streams: 0, pending_activities: 1 }));
  assert.match(waitingEnable, /enable is deferred until 1 pending launch resolves; the effective policy remains disabled/);
  assert.match(waitingEnable, /0 active streams · 1 pending launch/);
  assert.doesNotMatch(waitingEnable, /new streams/);
  const waitingDisable = describe(historyStatus({ enabled: false, effective_enabled: true,
    active_streams: 1, pending_activities: 2 }));
  assert.match(waitingDisable, /disable is deferred until 1 active stream ends and 2 pending launches resolve/);
  assert.match(waitingDisable, /1 active stream · 2 pending launches/);
  assert.doesNotMatch(waitingDisable, /new streams/);
  assert.match(describe(historyStatus({ enabled: true, effective_enabled: true,
    active_streams: 0, pending_activities: 0 })), /Recording is enabled for new streams.*0 pending launches/);
  assert.match(describe(historyStatus({ enabled: false, effective_enabled: false })), /Automatic retention and deletion are paused/);
  assert.doesNotMatch(describe(historyStatus()), /retention and deletion are paused/);
  assert.match(describe(historyStatus({ configuration_ready: false, degraded: true })), /configuration is not ready/);
  assert.match(describe(historyStatus({ available: false, configuration_ready: false })), /storage is unavailable/);
  assert.doesNotMatch(describe(historyStatus({ available: false, configuration_ready: false,
    pending_activities: 0 })), /pending launches|active streams/);
  assert.match(describe(historyStatus({ degraded: true, failed_operations: 3 })), /3 history storage operations have failed/);
  assert.doesNotMatch(describe(historyStatus({ degraded: true, failed_operations: 3 })), /successfully recorded|writes are healthy/);
  assert.match(describe(historyStatus({ degraded: true, last_prune: {
    ...historyStatus().status.last_prune, size_limit_bytes: 1024, size_limit_unmet: true,
  } })), /size limit remains unmet/);
});


test("history runtime status rejects malformed signed replies and counters", () => {
  const parse = pages.parseHistoryRuntimeStatus;
  const legacy = historyStatus();
  delete legacy.status.pending_activities;
  assert.equal(parse(legacy).pending_activities, 0);
  for (const reply of [null, {}, { ...historyStatus(), ok: false },
    historyStatus({ available: "true" }), historyStatus({ failed_operations: -1 }),
    historyStatus({ pending_activities: -1 }), historyStatus({ pending_activities: 1.5 }),
    historyStatus({ pending_activities: "1" }),
    historyStatus({ pending_activities: Number.MAX_SAFE_INTEGER + 1 }),
    historyStatus({ applied_revision: undefined }), historyStatus({ applied_revision: -1 }),
    historyStatus({ applied_revision: "4" }), historyStatus({ applied_revision: 1.5 }),
    historyStatus({ sessions: 1.5 }), historyStatus({ live_bytes: Number.MAX_SAFE_INTEGER + 1 }),
    historyStatus({ last_prune: null }),
    historyStatus({ last_prune: { ...historyStatus().status.last_prune, size_limit_unmet: "false" } }),
  ]) assert.throws(() => parse(reply));
});


test("recorded history follows returned offsets across short pages", async () => {
  const content = new FakeElement("main");
  content.setConnected(true);
  const offsets = [];
  const replies = [
    { sessions: [historySummary("first")], next_offset: 1 },
    { sessions: [historySummary("second"), historySummary("third")], next_offset: 3 },
    { sessions: [historySummary("fourth")], next_offset: null },
    { sessions: [historySummary("second"), historySummary("third")], next_offset: 3 },
  ];
  pages.renderSessions({
    content,
    notify() {},
    navigate() {},
    api: {
      allows: () => false,
      async post(route, payload) {
        if (route === "session/list") return { sessions: [], next_offset: null };
        if (route === "history/history_status") throw new Error("status unavailable");
        if (route === "history/list_sessions") {
          offsets.push(payload.offset);
          return { ok: true, ...replies.shift() };
        }
        throw new Error(`Unexpected route ${route}`);
      },
    },
  });
  const savedPagerButton = (label) => findAll(
    content,
    (node) => node.tagName === "button" && node.textContent === label,
  )[0];
  await waitFor(() => offsets.length === 1 && savedPagerButton("Next"), "first history page");
  assert.equal(savedPagerButton("Previous").disabled, true);
  savedPagerButton("Next").click();
  await waitFor(() => offsets.length === 2 && content.textContent.includes("second") && savedPagerButton("Next"), "second history page");
  assert.equal(offsets[1], 1);
  savedPagerButton("Next").click();
  await waitFor(() => offsets.length === 3 && content.textContent.includes("fourth") && savedPagerButton("Next"), "final history page");
  assert.equal(offsets[2], 3);
  assert.equal(savedPagerButton("Next").disabled, true);
  savedPagerButton("Previous").click();
  await waitFor(() => offsets.length === 4 && content.textContent.includes("second") && savedPagerButton("Next"), "previous history page");
  assert.equal(offsets[3], 1);
});


test("recorded session pages reject malformed signed rows before exposing delete", () => {
  const valid = { ok: true, sessions: [historySummary("stored")], next_offset: null };
  assert.equal(pages.parseHistoryListReply(valid, 0).sessions[0].session_id, "stored");
  for (const reply of [
    { ...valid, sessions: [{ ...historySummary("stored"), session_id: "" }] },
    { ...valid, sessions: [{ ...historySummary("stored"), session_id: "bad\nkey" }] },
    { ...valid, sessions: [{ ...historySummary("stored"), ended_at_unix: "yesterday" }] },
    { ...valid, sessions: [{ ...historySummary("stored"), app_name: null }] },
    { ...valid, sessions: [{ ...historySummary("stored"), device_name: null }] },
    { ...valid, sessions: [historySummary("stored"), historySummary("stored")] },
    { ...valid, next_offset: 0 },
  ]) assert.throws(() => pages.parseHistoryListReply(reply, 0));
});


test("recorded delete requires an explicit successful signed reply", () => {
  assert.equal(pages.parseHistoryDeleteReply({ ok: true }), undefined);
  for (const reply of [null, {}, { ok: false, code: "active_session" }, { ok: "true" }])
    assert.throws(() => pages.parseHistoryDeleteReply(reply));
});


test("recorded deletion readback requires the signed not-found result", async () => {
  const absent = { post: async () => { throw { code: "not_found" }; } };
  await pages.confirmHistoryDeletion(absent, "stored");
  for (const result of [
    { post: async () => historyDetail("stored") },
    { post: async () => { throw { code: "storage_error" }; } },
  ]) await assert.rejects(() => pages.confirmHistoryDeletion(result, "stored"));
});


test("malformed successful delete reply preserves the selected history and reports failure", async () => {
  const calls = [];
  const notices = [];
  const content = new FakeElement("main");
  content.setConnected(true);
  pages.renderSessions({ content, notify: (message) => notices.push(message), navigate() {}, api: {
    allows: (scope) => scope === "session.write",
    async post(route) {
      calls.push(route);
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status") return historyStatus();
      if (route === "history/list_sessions")
        return { ok: true, sessions: [historySummary("stored")], next_offset: null };
      if (route === "history/session_detail") return historyDetail("stored");
      if (route === "history/delete_session") return {};
      throw new Error(`Unexpected route ${route}`);
    },
  } });
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "enabled delete");
  findButton(content, "Details").click();
  await waitFor(() => content.textContent.includes("History for stored"), "selected detail");
  const previousConfirm = pageTestContext.confirmAction;
  pageTestContext.confirmAction = async () => true;
  try {
    findButton(content, "Delete").click();
    await waitFor(() => calls.includes("history/delete_session") &&
      content.textContent.includes("History deletion was not confirmed"), "unconfirmed deletion");
  } finally {
    pageTestContext.confirmAction = previousConfirm;
  }
  assert.match(content.textContent, /History for stored/);
  assert.deepEqual(notices, []);
});


test("confirmed recorded delete waits for signed absence before reporting success", async () => {
  let deleted = false;
  let finishReadback;
  const notices = [];
  const content = new FakeElement("main");
  content.setConnected(true);
  pages.renderSessions({ content, notify: (message) => notices.push(message), navigate() {}, api: {
    allows: (scope) => scope === "session.write",
    async post(route) {
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status") return historyStatus();
      if (route === "history/list_sessions")
        return { ok: true, sessions: deleted ? [] : [historySummary("stored")], next_offset: null };
      if (route === "history/delete_session") { deleted = true; return { ok: true }; }
      if (route === "history/session_detail")
        return new Promise((resolve, reject) => { finishReadback = () => reject({ code: "not_found" }); });
      throw new Error(`Unexpected route ${route}`);
    },
  } });
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "enabled delete");
  const previousConfirm = pageTestContext.confirmAction;
  pageTestContext.confirmAction = async () => true;
  try {
    findButton(content, "Delete").click();
    await waitFor(() => deleted && finishReadback, "pending signed readback");
    assert.deepEqual(notices, []);
    finishReadback();
    await waitFor(() => notices.length === 1 && content.textContent.includes("No recorded streams"), "confirmed delete");
  } finally {
    pageTestContext.confirmAction = previousConfirm;
  }
  assert.deepEqual(notices, ["Recorded session deleted."]);
});


test("recorded deletion follows signed runtime status while list and detail stay readable", async () => {
  let runtime = historyStatus({ enabled: false, effective_enabled: false });
  const calls = [];
  const api = {
    allows: (scope) => scope === "session.write",
    async post(route) {
      calls.push(route);
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status") return runtime;
      if (route === "history/list_sessions")
        return { ok: true, sessions: [historySummary("stored")], next_offset: null };
      if (route === "history/session_detail") return historyDetail("stored");
      throw new Error(`Unexpected route ${route}`);
    },
  };
  const mount = () => {
    const content = new FakeElement("main");
    content.setConnected(true);
    pages.renderSessions({ content, api, notify() {}, navigate() {} });
    return content;
  };
  let content = mount();
  await waitFor(() => findButton(content, "Delete")?.disabled &&
    content.textContent.includes("Deletion is unavailable while history recording is disabled"), "disabled history readback");
  findButton(content, "Details").click();
  await waitFor(() => content.textContent.includes("History for stored"), "stored detail while disabled");
  assert.equal(calls.filter((route) => route === "history/delete_session").length, 0);

  runtime = historyStatus({ enabled: false, effective_enabled: true, active_streams: 1 });
  findButton(content, "Refresh history status").click();
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "pending disable effective writer");

  runtime = historyStatus({ enabled: false, effective_enabled: false, active_streams: 0 });
  content.setConnected(false);
  content = mount();
  await waitFor(() => findButton(content, "Delete")?.disabled &&
    content.textContent.includes("Deletion is unavailable while history recording is disabled"), "disabled restart readback");
  runtime = historyStatus();
  findButton(content, "Refresh history status").click();
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "re-enabled writer");
  runtime = historyStatus({ enabled: false, effective_enabled: false });
  const previousConfirm = pageTestContext.confirmAction;
  let confirmations = 0;
  pageTestContext.confirmAction = async () => { confirmations += 1; return true; };
  try {
    findButton(content, "Delete").click();
    await waitFor(() => findButton(content, "Delete")?.disabled &&
      content.textContent.includes("Deletion is unavailable while history recording is disabled"), "delete preflight after writer shutdown");
  } finally {
    pageTestContext.confirmAction = previousConfirm;
  }
  assert.equal(confirmations, 0);
  assert.equal(calls.filter((route) => route === "history/delete_session").length, 0);
  findButton(content, "Details").click();
  await waitFor(() => content.textContent.includes("History for stored"), "detail after rejected delete");
});


test("recorded deletion rechecks signed status after a long-open confirmation", async () => {
  let runtime = historyStatus();
  const calls = [];
  const content = new FakeElement("main");
  content.setConnected(true);
  pages.renderSessions({ content, notify() {}, navigate() {}, api: {
    allows: (scope) => scope === "session.write",
    async post(route) {
      calls.push(route);
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status") return runtime;
      if (route === "history/list_sessions")
        return { ok: true, sessions: [historySummary("stored")], next_offset: null };
      if (route === "history/session_detail") return historyDetail("stored");
      throw new Error(`Unexpected route ${route}`);
    },
  } });
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "enabled history writer");
  const previousConfirm = pageTestContext.confirmAction;
  let finishConfirmation;
  let confirmations = 0;
  pageTestContext.confirmAction = () => {
    confirmations += 1;
    return new Promise((resolve) => { finishConfirmation = resolve; });
  };
  try {
    findButton(content, "Delete").click();
    await waitFor(() => confirmations === 1, "delete confirmation");
    runtime = historyStatus({ enabled: false, effective_enabled: false });
    finishConfirmation(true);
    await waitFor(() => findButton(content, "Delete")?.disabled &&
      content.textContent.includes("Deletion is unavailable while history recording is disabled"), "disabled writer after confirmation");
  } finally {
    pageTestContext.confirmAction = previousConfirm;
  }
  assert.equal(calls.filter((route) => route === "history/history_status").length, 3);
  assert.equal(calls.filter((route) => route === "history/delete_session").length, 0);
  findButton(content, "Details").click();
  await waitFor(() => content.textContent.includes("History for stored"), "stored detail after confirmation");
});


test("history status failure and stale status or list replies cannot re-enable deletion", async () => {
  const pendingStatuses = [];
  const pendingLists = [];
  const content = new FakeElement("main");
  content.setConnected(true);
  pages.renderSessions({ content, notify() {}, navigate() {}, api: {
    allows: (scope) => scope === "session.write",
    async post(route) {
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status")
        return new Promise((resolve, reject) => pendingStatuses.push({ resolve, reject }));
      if (route === "history/list_sessions")
        return new Promise((resolve) => pendingLists.push(resolve));
      throw new Error(`Unexpected route ${route}`);
    },
  } });
  pendingLists[0]({ ok: true, sessions: [historySummary("stored")], next_offset: null });
  pendingStatuses[0].resolve(historyStatus());
  await waitFor(() => findButton(content, "Delete")?.disabled === false, "initial enabled readback");

  findButton(content, "Refresh history status").click();
  assert.equal(findButton(content, "Delete").disabled, true);
  findButton(content, "Refresh").click();
  await waitFor(() => pendingStatuses.length === 3 && pendingLists.length === 2, "overlapping refreshes");
  pendingStatuses[2].resolve(historyStatus({ enabled: false, effective_enabled: false }));
  pendingLists[1]({ ok: true, sessions: [historySummary("current")], next_offset: null });
  await waitFor(() => content.textContent.includes("current") &&
    findButton(content, "Delete")?.disabled, "newer disabled readback");
  pendingStatuses[1].resolve(historyStatus());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(findButton(content, "Delete").disabled, true);
  assert.doesNotMatch(content.textContent, /Deletion is unavailable until history runtime status can be confirmed/);

  findButton(content, "Refresh history status").click();
  pendingStatuses[3].reject(new Error("status unavailable"));
  await waitFor(() => content.textContent.includes("Deletion is unavailable until history runtime status can be confirmed"), "unavailable status");
  assert.equal(findButton(content, "Delete").disabled, true);
  assert.ok(findButton(content, "Details"));

  findButton(content, "Refresh").click();
  findButton(content, "Refresh").click();
  await waitFor(() => pendingStatuses.length === 6 && pendingLists.length === 4, "overlapping list refreshes");
  pendingStatuses[5].resolve(historyStatus({ enabled: false, effective_enabled: false }));
  pendingLists[3]({ ok: true, sessions: [historySummary("latest")], next_offset: null });
  await waitFor(() => content.textContent.includes("latest"), "latest history page");
  pendingStatuses[4].resolve(historyStatus());
  pendingLists[2]({ ok: true, sessions: [historySummary("stale")], next_offset: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(content.textContent, /latest/);
  assert.doesNotMatch(content.textContent, /stale/);
  assert.equal(findButton(content, "Delete").disabled, true);
});


test("recorded detail readback rejects mismatched and malformed signed replies", () => {
  assert.equal(pages.parseHistoryDetailReply(historyDetail("first"), "first").detail.sample_count, 1);
  for (const reply of [
    { ...historyDetail("first"), ok: false },
    historyDetail("other"),
    { ...historyDetail("first"), detail: { ...historyDetail("first").detail, sample_count: -1 } },
    { ...historyDetail("first"), detail: { ...historyDetail("first").detail,
      samples: [{ ...historyDetail("first").detail.samples[0], actual_fps: Number.NaN }] } },
    { ...historyDetail("first"), detail: { ...historyDetail("first").detail,
      events: [{ ...historyDetail("first").detail.events[0], session_id: "other" }] } },
  ]) assert.throws(() => pages.parseHistoryDetailReply(reply, "first"));
});


test("full history loading preserves an engaged recent view until the user applies it", async () => {
  let finishOpen;
  const samples = Array.from({length:55},(_,index)=>({session_id:"stored",recorded_at_unix:100+index,
    frames_sent:index,bytes_sent:index*100,dropped_frames:0,actual_fps:60,actual_bitrate_kbps:1000,encode_latency_ms:null}));
  const first = historyDetail("stored");
  first.detail.sample_count = 55;
  first.detail.samples_truncated = true;
  const api = {allows:()=>false, async post(route,payload) {
    if(route === "session/list") return {sessions:[],next_offset:null};
    if(route === "history/history_status") return historyStatus();
    if(route === "history/list_sessions") return {ok:true,sessions:[historySummary("stored")],next_offset:null};
    if(route === "history/session_detail") return first;
    if(route === "history/timeline_open") return new Promise((resolve)=>{finishOpen=resolve;});
    if(route === "history/timeline_page") {
      if(payload.kind === "events") return {ok:true,session_id:"stored",kind:"events",total:1,
        entries:first.detail.events,next_cursor:null};
      const start = payload.cursor.after_id === null ? 0 : Number(payload.cursor.after_id);
      const entries = samples.slice(start,start+32);
      const end = start+entries.length;
      return {ok:true,session_id:"stored",kind:"samples",total:55,entries,
        next_cursor:end===55 ? null : {...payload.cursor,after_id:String(end)}};
    }
    throw new Error(`Unexpected route ${route}`);
  }};
  const content = new FakeElement("main"); content.setConnected(true);
  pages.renderSessions({content,api,notify(){},navigate(){}});
  await waitFor(()=>!!findAll(content,(node)=>node.tagName === "button" && node.textContent === "Details").length,"history list");
  findAll(content,(node)=>node.tagName === "button" && node.textContent === "Details")[0].click();
  await waitFor(()=>!!finishOpen && content.textContent.includes("History for stored"),"recent snapshot and full loading");
  const view = findAll(content,(node)=>node.className === "panel recorded-session-detail")[0];
  view.listeners.get("pointerdown")();
  finishOpen({ok:true,session:historySummary("stored"),
    samples:{total:55,cursor:{session_id:"stored",kind:"samples",first_id:"1",last_id:"55",after_id:null,total:55}},
    events:{total:1,cursor:{session_id:"stored",kind:"events",first_id:"100",last_id:"100",after_id:null,total:1}}});
  await waitFor(()=>content.textContent.includes("Full retained history is ready"),"full history ready");
  assert.match(content.textContent,/1 of 55 samples/);
  findButton(content,"Show full retained history").click();
  assert.match(content.textContent,/55 of 55 samples/);
  assert.ok(findButton(content,"Download retained history (JSON)"));
  assert.match(content.textContent,/Samples 1–50 of 55/);
});


test("recorded detail keeps the latest selection after older success or failure and reads again after remount", async () => {
  const pending = [];
  const api = {
    allows: () => false,
    async post(route) {
      if (route === "session/list") return { sessions: [], next_offset: null };
      if (route === "history/history_status") return historyStatus();
      if (route === "history/list_sessions")
        return { ok: true, sessions: [historySummary("first"), historySummary("second")], next_offset: null };
      if (route === "history/session_detail")
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      throw new Error(`Unexpected route ${route}`);
    },
  };
  const mount = () => {
    const content = new FakeElement("main");
    content.setConnected(true);
    pages.renderSessions({ content, api, notify() {}, navigate() {} });
    return content;
  };
  const content = mount();
  await waitFor(() => findAll(content, (node) => node.tagName === "button" && node.textContent === "Details").length === 2, "history list");
  let details = findAll(content, (node) => node.tagName === "button" && node.textContent === "Details");
  details[0].click();
  details[1].click();
  pending[1].resolve(historyDetail("second"));
  await waitFor(() => content.textContent.includes("History for second"), "newer detail");
  pending[0].resolve(historyDetail("first"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(content.textContent, /History for second/);
  assert.doesNotMatch(content.textContent, /History for first/);

  details[0].click();
  details[1].click();
  pending[3].resolve(historyDetail("second"));
  await waitFor(() => content.textContent.includes("History for second"), "newer detail again");
  pending[2].reject(new Error("old storage failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.doesNotMatch(content.textContent, /old storage failure/);

  details[0].click();
  pending[4].reject(new Error("current storage failure"));
  await waitFor(() => content.textContent.includes("current storage failure"), "current detail failure");
  findButton(content, "Try again").click();
  pending[5].resolve(historyDetail("first"));
  await waitFor(() => content.textContent.includes("History for first"), "retried detail readback");

  content.setConnected(false);
  const reopened = mount();
  await waitFor(() => findAll(reopened, (node) => node.tagName === "button" && node.textContent === "Details").length === 2, "reopened history list");
  details = findAll(reopened, (node) => node.tagName === "button" && node.textContent === "Details");
  details[0].click();
  pending[6].resolve(historyDetail("first"));
  await waitFor(() => reopened.textContent.includes("History for first"), "reopened detail");
  assert.match(reopened.textContent, /1 samples.*1 events/);
  assert.match(reopened.textContent, /stream_started/);
});


function cleanupOverview(t, content) {
  t.after(() => {
    content.setConnected(false);
    for (const observer of pageTestContext.observers) observer.callback();
  });
}


function historyStatus(overrides = {}) {
  return {
    ok: true,
    status: {
      available: true,
      configuration_ready: true,
      applied_revision: 4,
      enabled: true,
      effective_enabled: true,
      degraded: false,
      failed_operations: 0,
      active_streams: 1,
      pending_activities: 0,
      sessions: 4,
      samples: 20,
      events: 3,
      live_bytes: 4096,
      last_prune: {
        sessions_deleted: 2,
        live_bytes: 4096,
        size_limit_bytes: 0,
        size_limit_unmet: false,
      },
      ...overrides,
    },
  };
}


function liveStatus(count = 0) {
  return { ok: true, epoch: "a".repeat(32), sampled_at_ms: "1000", sampled_at_unix_ms: "1700000000000",
    sessions: Array.from({ length: count }, (_, index) => ({ session_id: `stream-${index}`, started_at_unix: 1700000000,
      device_name: "Client", codec: "hevc", width: 1920, height: 1080, target_fps: 60,
      target_bitrate_kbps: 10000, frames_sent: "1", bytes_sent: "2", sequence_gaps: "0" })) };
}


function syncStatus(overrides = {}) {
  const base = {
    revision: 3,
    settings_ready: true,
    enabled: true,
    game_count: 0,
    scanning: false,
    complete: true,
    warnings: [],
    warning_count: 0,
    force_sync_pending: false,
    catalog_sync: {
      enabled: false,
      syncing: false,
      force_sync_pending: false,
      last_error: null,
    },
  };
  return {
    ...base,
    ...overrides,
    catalog_sync: { ...base.catalog_sync, ...overrides.catalog_sync },
  };
}


function createHarness({
  allowsRefresh,
  allowsRead = true,
  forceReply,
  statuses,
  listReplies = [],
}) {
  const content = new FakeElement("main");
  content.setConnected(true);
  const calls = [];
  const notifications = [];
  const api = {
    allows: (scope) =>
      (scope === "steam.refresh" && allowsRefresh) ||
      (scope === "steam.read" && allowsRead),
    async post(route, payload = {}) {
      calls.push({ route, payload });
      if (route === "steam/list") {
        return listReplies.shift() ?? {
          revision: 3,
          games: [],
          next_after: null,
          scanning: false,
          complete: true,
        };
      }
      if (route === "steam/status") return statuses.shift() ?? syncStatus();
      if (route === "steam/force_sync") return forceReply;
      throw new Error(`Unexpected route ${route}`);
    },
  };
  pages.renderSteam({
    content,
    api,
    notify: (message) => notifications.push(message),
    navigate() {},
  });
  return { content, calls, notifications, timers: pageTestContext.timers };
}


function findAll(node, predicate) {
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children
      .filter((child) => child instanceof FakeElement)
      .flatMap((child) => findAll(child, predicate)),
  ];
}


function findButton(root, label) {
  return findAll(
    root,
    (node) => node.tagName === "button" && node.textContent === label,
  )[0];
}


async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${description}`);
}


function pageReady(content) {
  return findAll(
    content,
    (node) => node.tagName === "h3" && node.textContent === "No Steam discoveries",
  ).length > 0;
}


function historySummary(sessionId) {
  return {
    session_id: sessionId,
    protocol: "rtsp",
    client_name: "Client",
    device_name: "Device",
    app_name: sessionId,
    width: 1920,
    height: 1080,
    target_fps: 60,
    target_bitrate_kbps: 10000,
    codec: "h264",
    started_at_unix: 100,
    ended_at_unix: 120,
    duration_seconds: 20,
  };
}


function historyDetail(sessionId) {
  return {
    ok: true,
    detail: {
      session: historySummary(sessionId),
      sample_count: 1,
      event_count: 1,
      samples_truncated: false,
      events_truncated: false,
      samples: [{ session_id: sessionId, recorded_at_unix: 101, frames_sent: 60,
        bytes_sent: 4096, dropped_frames: 0, actual_fps: 60, actual_bitrate_kbps: 8000 }],
      events: [{ session_id: sessionId, recorded_at_unix: 102, event_type: "stream_started", payload: null }],
    },
  };
}


function diagnosticReply(after, message, overrides = {}) {
  const sequence = after + 1;
  return {
    ok: true,
    records: [{ sequence, level: "info", target: "capture", message, fields: { source: "host" } }],
    next_cursor: sequence,
    has_more: false,
    latest_sequence: sequence,
    oldest_sequence: sequence,
    dropped_total: 0,
    resync_required: false,
    ...overrides,
  };
}


function diagnosticSession(id, overrides = {}) {
  return {
    session_id: id,
    protocol: "moonlight",
    client_name: `private-client-${id}`,
    device_name: `private-device-${id}`,
    app_name: `private-app-${id}`,
    width: 1920,
    height: 1080,
    target_fps: 60,
    target_bitrate_kbps: 12000,
    codec: "h264",
    started_at_unix: 10,
    ended_at_unix: 20,
    duration_seconds: 10,
    ...overrides,
  };
}


function diagnosticHistoryDetail(session, events = []) {
  return { ok: true, detail: {
    session,
    sample_count: 0,
    event_count: events.length,
    samples_truncated: false,
    events_truncated: false,
    samples: [],
    events: events.map((event, index) => ({
      session_id: session.session_id,
      recorded_at_unix: 15 + index,
      payload: null,
      ...event,
    })),
  } };
}


function journalPage(after, sequences, latest, overrides = {}) {
  return {
    ok: true,
    records: sequences.map((sequence) => ({ sequence, level: "info", target: "capture", message: `record ${sequence}`, fields: {} })),
    next_cursor: sequences.at(-1) ?? after,
    has_more: (sequences.at(-1) ?? after) < latest,
    latest_sequence: latest,
    oldest_sequence: latest ? 1 : null,
    dropped_total: 0,
    resync_required: false,
    ...overrides,
  };
}


test("nearby history cards load and apply complete member snapshots without losing engagement", async () => {
  const newer = {...historySummary("new"),app_name:"Same game",started_at_unix:300,ended_at_unix:400,duration_seconds:100};
  const older = {...historySummary("old"),app_name:"Same game",started_at_unix:100,ended_at_unix:180,duration_seconds:80};
  const first=historyDetail("new"); first.detail.session=newer;
  const second=historyDetail("old"); second.detail.session=older; second.detail.sample_count=33; second.detail.samples_truncated=true;
  const samples=Array.from({length:33},(_,index)=>({...second.detail.samples[0],recorded_at_unix:100+index,frames_sent:index}));
  let finishOpen;
  const calls=[];
  const api={allows:()=>false,async post(route,payload) {
    calls.push([route,payload]);
    if(route === "session/list") return {sessions:[],next_offset:null};
    if(route === "history/history_status") return historyStatus();
    if(route === "history/list_sessions") return {ok:true,sessions:[newer,older],next_offset:null};
    if(route === "history/session_detail") return payload.session_id === "new" ? first : second;
    if(route === "history/timeline_open") return new Promise((resolve)=>{finishOpen=resolve;});
    if(route === "history/timeline_page") {
      const {kind,cursor}=payload;
      if(kind === "events") return {ok:true,session_id:"old",kind,total:1,entries:second.detail.events,next_cursor:null};
      const start=cursor.after_id === null ? 0 : Number(cursor.after_id);
      const end=Math.min(33,start+payload.limit);
      return {ok:true,session_id:"old",kind,total:33,entries:samples.slice(start,end),
        next_cursor:end===33 ? null : {...cursor,after_id:String(end)}};
    }
    throw new Error(`Unexpected route ${route}`);
  }};
  const content=new FakeElement("main"); content.setConnected(true);
  pages.renderSessions({content,api,notify(){},navigate(){}});
  await waitFor(()=>content.textContent.includes("2 nearby streams"),"grouped history card");
  const card=findAll(content,(node)=>node.className === "history-card")[0];
  findAll(card,(node)=>node.tagName === "button" && node.textContent === "Details")[0].click();
  await waitFor(()=>!!finishOpen && content.textContent.includes("History for Same game"),"grouped recent history");
  assert.match(content.textContent,/2 of 34 samples/);
  assert.match(content.textContent,/reconnect is not confirmed/);
  const view=findAll(content,(node)=>node.className === "panel recorded-session-detail")[0];
  view.listeners.get("pointerdown")();
  finishOpen({ok:true,session:older,
    samples:{total:33,cursor:{session_id:"old",kind:"samples",first_id:"1",last_id:"33",after_id:null,total:33}},
    events:{total:1,cursor:{session_id:"old",kind:"events",first_id:"100",last_id:"100",after_id:null,total:1}}});
  await waitFor(()=>content.textContent.includes("Full retained history is ready for all streams"),"group snapshots ready");
  assert.match(content.textContent,/2 of 34 samples/);
  findButton(content,"Show full retained history").click();
  assert.match(content.textContent,/34 of 34 samples/);
  assert.equal(calls.filter(([route])=>route === "history/timeline_open").length,1);
  assert.equal(findAll(card,(node)=>node.tagName === "button" && node.textContent === "Delete").length,2);
});


test("oversized grouped history keeps recent snapshots and does not start a full download", async () => {
  const newer={...historySummary("new"),app_name:"Same game",started_at_unix:300,ended_at_unix:400};
  const older={...historySummary("old"),app_name:"Same game",started_at_unix:100,ended_at_unix:180};
  const api={allows:()=>false,async post(route,payload) {
    if(route === "session/list") return {sessions:[],next_offset:null};
    if(route === "history/history_status") return historyStatus();
    if(route === "history/list_sessions") return {ok:true,sessions:[newer,older],next_offset:null};
    if(route === "history/session_detail") {
      const reply=historyDetail(payload.session_id); reply.detail.session=payload.session_id === "new" ? newer : older;
      if(payload.session_id === "old") { reply.detail.sample_count=25001; reply.detail.samples_truncated=true; }
      return reply;
    }
    throw new Error(`Unexpected route ${route}`);
  }};
  const content=new FakeElement("main");content.setConnected(true);
  pages.renderSessions({content,api,notify(){},navigate(){}});
  await waitFor(()=>content.textContent.includes("2 nearby streams"),"grouped card");
  findAll(content,(node)=>node.className === "history-card")[0].children.find((node)=>node?.className === "actions").children[0].click();
  await waitFor(()=>content.textContent.includes("This group exceeds the browser limit"),"bounded group notice");
  assert.match(content.textContent,/2 of 25002 samples/);
  assert.match(content.textContent,/open an individual stream/i);
});


test("late grouped history reads cannot replace a newer individual selection", async () => {
  const newer={...historySummary("new"),app_name:"Same game",started_at_unix:300,ended_at_unix:400};
  const older={...historySummary("old"),app_name:"Same game",started_at_unix:100,ended_at_unix:180};
  const pending=[]; let calls=0;
  const api={allows:()=>false,async post(route,payload) {
    if(route === "session/list") return {sessions:[],next_offset:null};
    if(route === "history/history_status") return historyStatus();
    if(route === "history/list_sessions") return {ok:true,sessions:[newer,older],next_offset:null};
    if(route === "history/session_detail") {
      const reply=historyDetail(payload.session_id); reply.detail.session=payload.session_id === "new" ? newer : older;
      if(++calls<=2) return new Promise((resolve)=>pending.push(()=>resolve(reply)));
      return reply;
    }
    throw new Error(`Unexpected route ${route}`);
  }};
  const content=new FakeElement("main");content.setConnected(true);
  pages.renderSessions({content,api,notify(){},navigate(){}});
  await waitFor(()=>content.textContent.includes("2 nearby streams"),"grouped card");
  const card=findAll(content,(node)=>node.className === "history-card")[0];
  const details=findAll(card,(node)=>node.tagName === "button" && node.textContent === "Details");
  details[0].click();
  await waitFor(()=>pending.length===2,"group member requests");
  details[1].click();
  await waitFor(()=>content.textContent.includes("History for Same game") && content.textContent.includes("1 of 1 samples"),"individual selection");
  pending.forEach((resolve)=>resolve());
  await new Promise((resolve)=>setTimeout(resolve,0));
  const view=findAll(content,(node)=>node.className === "panel recorded-session-detail")[0];
  assert.match(view.textContent,/1 of 1 samples/);
  assert.doesNotMatch(view.textContent,/nearby streams/);
});


test("a failed grouped full-history read leaves the recent member snapshots visible", async () => {
  const newer={...historySummary("new"),app_name:"Same game",started_at_unix:300,ended_at_unix:400};
  const older={...historySummary("old"),app_name:"Same game",started_at_unix:100,ended_at_unix:180};
  const api={allows:()=>false,async post(route,payload) {
    if(route === "session/list") return {sessions:[],next_offset:null};
    if(route === "history/history_status") return historyStatus();
    if(route === "history/list_sessions") return {ok:true,sessions:[newer,older],next_offset:null};
    if(route === "history/session_detail") {
      const reply=historyDetail(payload.session_id);reply.detail.session=payload.session_id === "new" ? newer : older;
      if(payload.session_id === "old") { reply.detail.sample_count=33;reply.detail.samples_truncated=true; }
      return reply;
    }
    if(route === "history/timeline_open") throw new Error("history_changed");
    throw new Error(`Unexpected route ${route}`);
  }};
  const content=new FakeElement("main");content.setConnected(true);
  pages.renderSessions({content,api,notify(){},navigate(){}});
  await waitFor(()=>content.textContent.includes("2 nearby streams"),"grouped card");
  const card=findAll(content,(node)=>node.className === "history-card")[0];
  findAll(card,(node)=>node.tagName === "button" && node.textContent === "Details")[0].click();
  await waitFor(()=>content.textContent.includes("no partial full-history result was applied"),"group failure");
  assert.match(content.textContent,/2 of 34 samples/);
  assert.ok(findButton(content,"Download returned history (JSON)"));
  assert.ok(findButton(content,"Try again"));
});