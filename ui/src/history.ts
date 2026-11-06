namespace Amaterasu {
  function pagesTextLiteral(value: string): TextValue {
    return typeof Amaterasu.literalText === "function" ? Amaterasu.literalText(value) : value;
  }

  function pagesTextMessage(value: string): TextValue {
    return typeof Amaterasu.localizedMessage === "function" ? Amaterasu.localizedMessage(value) : value;
  }

  function pagesSetLocalizedTextContent(target: HTMLElement, source: string): void {
    if (typeof Amaterasu.setLocalizedTextContent === "function") {
      Amaterasu.setLocalizedTextContent(target, source);
    } else {
      target.textContent = source;
    }
  }

  function localizedDateTime(unixSeconds: number): Node | string {
    const date = new Date(unixSeconds * 1000);
    return typeof Amaterasu.localeFormattedTextNode === "function"
      ? Amaterasu.localeFormattedTextNode((locale) => date.toLocaleString(locale))
      : date.toLocaleString();
  }

  export function parseHistoryRuntimeStatus(value: unknown): HistoryRuntimeStatus {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("History status reply is invalid.");
    const reply = value as Record<string, unknown>;
    if (reply.ok !== true || !reply.status || typeof reply.status !== "object" || Array.isArray(reply.status))
      throw new Error("History status reply is invalid.");
    const status = reply.status as Record<string, unknown>;
    if (status.applied_revision !== null &&
        (!Number.isSafeInteger(status.applied_revision) || (status.applied_revision as number) < 0))
      throw new Error("History applied revision is invalid.");
    const prune = status.last_prune;
    if (!prune || typeof prune !== "object" || Array.isArray(prune))
      throw new Error("History retention status is invalid.");
    const retention = prune as Record<string, unknown>;
    for (const key of ["available", "configuration_ready", "enabled", "effective_enabled", "degraded"])
      if (typeof status[key] !== "boolean") throw new Error(`History ${key} status is invalid.`);
    for (const key of ["failed_operations", "active_streams", "sessions", "samples", "events", "live_bytes"])
      if (!Number.isSafeInteger(status[key]) || (status[key] as number) < 0)
        throw new Error(`History ${key} count is invalid.`);
    if (status.pending_activities !== undefined &&
        (!Number.isSafeInteger(status.pending_activities) || (status.pending_activities as number) < 0))
      throw new Error("History pending activities count is invalid.");
    for (const key of ["sessions_deleted", "live_bytes", "size_limit_bytes"])
      if (!Number.isSafeInteger(retention[key]) || (retention[key] as number) < 0)
        throw new Error(`History retention ${key} count is invalid.`);
    if (typeof retention.size_limit_unmet !== "boolean")
      throw new Error("History retention limit status is invalid.");
    return { ...status, pending_activities: status.pending_activities ?? 0 } as unknown as HistoryRuntimeStatus;
  }

  export function historyRecordingPolicyDescription(status: HistoryRuntimeStatus): string {
    if (!status.configuration_ready)
      return "History configuration is not ready; recording is not confirmed.";
    if (status.effective_enabled !== status.enabled) {
      const action = status.enabled ? "enable" : "disable";
      const effective = status.effective_enabled ? "enabled" : "disabled";
      if (status.pending_activities > 0) {
        const pending = status.pending_activities === 1
          ? "1 pending launch resolves"
          : `${status.pending_activities} pending launches resolve`;
        const active = status.active_streams > 0
          ? `${status.active_streams} active ${status.active_streams === 1 ? "stream ends" : "streams end"} and `
          : "";
        return `Recording ${action} is deferred until ${active}${pending}; the effective policy remains ${effective}.`;
      }
      return `Recording ${action} is deferred until active streams end; new streams still use the ${effective} policy.`;
    }
    const effective = status.effective_enabled ? "enabled" : "disabled";
    return status.pending_activities > 0
      ? `Recording is ${effective} under the current policy; pending launches have not joined yet.`
      : `Recording is ${effective} for new streams.`;
  }

  export function historyActivityDescription(status: HistoryRuntimeStatus): string {
    const active = `${status.active_streams} active ${status.active_streams === 1 ? "stream" : "streams"}`;
    const pending = `${status.pending_activities} pending ${status.pending_activities === 1 ? "launch" : "launches"}`;
    return `${active} · ${pending}`;
  }

  export function historyRuntimeDescription(status: HistoryRuntimeStatus): string[] {
    if (!status.available)
      return ["History storage is unavailable; recording and recorded session reads cannot run."];
    const lines = [status.applied_revision === null
      ? "Runtime configuration revision is not confirmed."
      : `Runtime applied configuration revision ${status.applied_revision}.`,
      historyRecordingPolicyDescription(status)];
    lines.push(`${historyActivityDescription(status)} · ${status.sessions} stored sessions · ${status.samples} samples · ${status.events} events · ${status.live_bytes} live bytes.`);
    if (status.configuration_ready && !status.effective_enabled)
      lines.push("Stored sessions remain readable. Automatic retention and deletion are paused until recording is enabled.");
    lines.push(`Last retention pass deleted ${status.last_prune.sessions_deleted} sessions; ${status.last_prune.live_bytes} live bytes against ${status.last_prune.size_limit_bytes === 0 ? "no size limit" : `${status.last_prune.size_limit_bytes} byte limit`}.`);
    if (status.last_prune.size_limit_unmet)
      lines.push("The retention size limit remains unmet; active sessions are preserved.");
    if (status.failed_operations > 0)
      lines.push(`${status.failed_operations} history storage operations have failed since this service started.`);
    if (status.degraded && status.failed_operations === 0 && !status.last_prune.size_limit_unmet && status.configuration_ready)
      lines.push("History reports degraded operation.");
    return lines;
  }

  export function parseHistoryDetailReply(value: unknown, sessionId: string): HistoryDetailReply {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("History detail reply is invalid.");
    const reply = value as Record<string, unknown>;
    if (reply.ok !== true || !reply.detail || typeof reply.detail !== "object" || Array.isArray(reply.detail))
      throw new Error("History detail reply is invalid.");
    const detail = reply.detail as Record<string, unknown>;
    const session = detail.session;
    if (!session || typeof session !== "object" || Array.isArray(session) ||
      (session as Record<string, unknown>).session_id !== sessionId)
      throw new Error("History detail belongs to a different session.");
    parseHistoryListReply({ ok: true, sessions: [session], next_offset: null }, 0);
    const summary = session as Record<string, unknown>;
    if (["device_name", "codec"].some((key) => typeof summary[key] !== "string") ||
      ["width", "height", "target_fps", "target_bitrate_kbps"].some((key) =>
        !Number.isSafeInteger(summary[key]) || (summary[key] as number) < 0 || (summary[key] as number) > 0xffff_ffff))
      throw new Error("History session metadata is invalid.");
    for (const key of ["sample_count", "event_count"])
      if (!Number.isSafeInteger(detail[key]) || (detail[key] as number) < 0)
        throw new Error(`History ${key} is invalid.`);
    for (const key of ["samples_truncated", "events_truncated"])
      if (typeof detail[key] !== "boolean") throw new Error(`History ${key} is invalid.`);
    for (const [key, countKey] of [["samples", "sample_count"], ["events", "event_count"]] as const) {
      const rows = detail[key];
      const truncated = detail[key === "samples" ? "samples_truncated" : "events_truncated"];
      if (!Array.isArray(rows) || rows.length > (key === "samples" ? 32 : 8) ||
        rows.length > (detail[countKey] as number) || truncated !== (rows.length < (detail[countKey] as number)) || rows.some((row) =>
        !row || typeof row !== "object" || Array.isArray(row) || row.session_id !== sessionId ||
        !Number.isSafeInteger(row.recorded_at_unix)))
        throw new Error(`History ${key} are invalid.`);
    }
    for (const sample of detail.samples as Record<string, unknown>[]) {
      for (const key of ["frames_sent", "bytes_sent", "dropped_frames"])
        if (!Number.isSafeInteger(sample[key]) || (sample[key] as number) < 0)
          throw new Error(`History sample ${key} is invalid.`);
      for (const key of ["actual_fps", "actual_bitrate_kbps"])
        if (typeof sample[key] !== "number" || !Number.isFinite(sample[key]) || sample[key] < 0)
          throw new Error(`History sample ${key} is invalid.`);
      if (sample.encode_latency_ms != null && (typeof sample.encode_latency_ms !== "number" ||
        !Number.isFinite(sample.encode_latency_ms) || sample.encode_latency_ms < 0))
        throw new Error("History sample encode_latency_ms is invalid.");
    }
    if ((detail.events as Record<string, unknown>[]).some((event) => typeof event.event_type !== "string"))
      throw new Error("History event type is invalid.");
    return reply as unknown as HistoryDetailReply;
  }

  export function parseHistoryListReply(value: unknown, offset: number): HistoryListReply {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("History session page is invalid.");
    const reply = value as Record<string, unknown>;
    if (reply.ok !== true || !Array.isArray(reply.sessions) || reply.sessions.length > 25 ||
        (reply.next_offset !== null && (!Number.isSafeInteger(reply.next_offset) ||
          (reply.next_offset as number) <= offset)))
      throw new Error("History session page is invalid.");
    const ids = new Set<string>();
    for (const entry of reply.sessions) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("History session row is invalid.");
      const session = entry as Record<string, unknown>;
      if (typeof session.session_id !== "string" || session.session_id.length === 0 ||
          new TextEncoder().encode(session.session_id).length > 128 ||
          /[\u0000-\u001f\u007f-\u009f]/u.test(session.session_id) ||
          ["app_name", "client_name", "device_name", "protocol", "codec"].some((key) => typeof session[key] !== "string") ||
          ["width", "height", "target_fps", "target_bitrate_kbps"].some((key) =>
            !Number.isSafeInteger(session[key]) || (session[key] as number) < 0 || (session[key] as number) > 0xffff_ffff) ||
          !Number.isSafeInteger(session.started_at_unix) ||
          (session.ended_at_unix !== null && !Number.isSafeInteger(session.ended_at_unix)) ||
          (session.duration_seconds !== null &&
            (!Number.isSafeInteger(session.duration_seconds) || (session.duration_seconds as number) < 0)))
        throw new Error("History session row is invalid.");
      if (ids.has(session.session_id)) throw new Error("History session page contains a duplicate stream.");
      ids.add(session.session_id);
    }
    return reply as unknown as HistoryListReply;
  }

  export function parseHistoryDeleteReply(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (value as Record<string, unknown>).ok !== true)
      throw new Error("History deletion was not confirmed. Refresh the recorded sessions before trying again.");
  }

  export async function confirmHistoryDeletion(api: Pick<Api, "post">, sessionId: string): Promise<void> {
    try {
      await api.post<unknown>("history/session_detail", { session_id: sessionId });
    } catch (error) {
      if (error && typeof error === "object" &&
          (error as { code?: unknown }).code === "not_found") return;
      throw error;
    }
    throw new Error("History deletion could not be confirmed by readback. Refresh the recorded sessions.");
  }

  export function renderSessions(context: PageContext): void {
    const metricsArea = el("div");
    const historyRuntimeArea = el("div");
    const savedArea = el("div");
    const savedDetail = el("div");
    const savedStatus = el("div");
    let savedOffset = 0;
    const savedHistory = [0];
    let savedListRequest = 0;
    let savedDetailRequest = 0;
    let timelineRequest = 0;
    let historyStatusRequest = 0;
    let historyDeleteAvailable = false;
    let historyDeleteReason = "Checking history status before deletion is available.";
    let deleteControls: { button: HTMLButtonElement; ended: boolean }[] = [];
    const deleteNotice = el("p", "muted", historyDeleteReason);
    let selectedSavedSessions = new Set<string>();
    const savedHistoryPanel = panel("Recorded stream sessions", savedArea, savedStatus, savedDetail);
    context.content.append(
      sectionHeading(
        "Statistics",
        "Live host measurements and recorded streaming performance.",
        button("Refresh", () => {
          void loadHistoryRuntime();
          void loadSaved();
        }),
      ),
      metricsArea,

      panel("History runtime status", historyRuntimeArea),
      savedHistoryPanel,
    );

    function applyHistoryDeleteAvailability(): void {
      pagesSetLocalizedTextContent(deleteNotice, historyDeleteReason);
      for (const control of deleteControls)
        control.button.disabled = !control.ended || !context.api.allows("session.write") || !historyDeleteAvailable;
    }
    async function loadHistoryRuntime(): Promise<boolean> {
      const request = ++historyStatusRequest;
      historyDeleteAvailable = false;
      historyDeleteReason = "Checking history status before deletion is available.";
      applyHistoryDeleteAvailability();
      historyRuntimeArea.replaceChildren(el("p", "muted", "Loading history runtime status…"));
      try {
        const runtime = parseHistoryRuntimeStatus(await context.api.post<unknown>("history/history_status"));
        if (!context.content.isConnected || request !== historyStatusRequest) return false;
        historyDeleteAvailable = runtime.available && runtime.configuration_ready && runtime.effective_enabled;
        historyDeleteReason = historyDeleteAvailable
          ? ""
          : runtime.available && runtime.configuration_ready && !runtime.effective_enabled
            ? "Deletion is unavailable while history recording is disabled. Stored sessions remain readable."
            : "Deletion is unavailable until history storage and configuration are ready.";
        applyHistoryDeleteAvailability();
        historyRuntimeArea.replaceChildren(
          ...historyRuntimeDescription(runtime).map((line) => el("p", "muted", line)),
          button("Refresh history status", () => { void loadHistoryRuntime(); }),
        );
        return historyDeleteAvailable;
      } catch (error) {
        if (context.content.isConnected && request === historyStatusRequest) {
          historyDeleteReason = "Deletion is unavailable until history runtime status can be confirmed. Stored sessions remain readable.";
          applyHistoryDeleteAvailability();
          historyRuntimeArea.replaceChildren(errorPanel(error, () => { void loadHistoryRuntime(); }));
        }
        return false;
      }
    }
    async function loadSaved(): Promise<void> {
      const request = ++savedListRequest;
      savedArea.replaceChildren(el("p", "muted", "Loading recorded sessions…"));
      try {
        const reply = parseHistoryListReply(await context.api.post<unknown>(
          "history/list_sessions",
          { limit: 25, offset: savedOffset },
        ), savedOffset);
        if (!context.content.isConnected || request !== savedListRequest) return;
        const currentDeleteControls: typeof deleteControls = [];
        function deleteButton(session: HistorySessionSummary): HTMLButtonElement {
          const remove = button(
            "Delete",
            async () => {
              if (!context.api.allows("session.write") || !historyDeleteAvailable || !(await loadHistoryRuntime())) return;
              if (
                !(await confirmAction(
                  "Delete this recorded session?",
                  pagesTextLiteral(`The history for ${session.app_name || session.session_id} will be removed.`),
                  "Delete history", context.ui,
                ))
              )
                return;
              // The writer may have drained while the confirmation was open.
              if (!context.api.allows("session.write") || !historyDeleteAvailable || !(await loadHistoryRuntime())) return;
              await runAction(remove, savedStatus, async () => {
                parseHistoryDeleteReply(await context.api.post<unknown>("history/delete_session", {
                  session_id: session.session_id,
                }));
                await confirmHistoryDeletion(context.api, session.session_id);
                if (selectedSavedSessions.has(session.session_id)) {
                  ++savedDetailRequest;
                  ++timelineRequest;
                  selectedSavedSessions.clear();
                  savedDetail.replaceChildren();
                }
                context.notify(pagesTextMessage("Recorded session deleted."));
                await loadSaved();
              });
              await loadHistoryRuntime();
            },
            "quiet danger-text",
          );
          currentDeleteControls.push({ button: remove, ended: session.ended_at_unix != null });
          return remove;
        }
        const groups = groupRecordedSessions(reply.sessions);
        const cards = groups.map((members) => {
          const session = members[0]!;
          const details = button("Details", () => members.length > 1
            ? loadSavedGroup(members) : loadSavedDetail(session.session_id));
          const memberControls = members.length === 1 ? deleteButton(session) : el("details", "history-card-members",
            el("summary", "", pagesTextLiteral(`Manage ${members.length} individual streams`)),
            ...members.map((member) => el("div", "history-card-member",
              el("div", "", el("strong", "", pagesTextLiteral(member.session_id)),
                el("small", "muted block", localizedDateTime(member.started_at_unix))),
              el("div", "actions", button("Details", () => loadSavedDetail(member.session_id)), deleteButton(member)))));
          const resolution = session.width && session.height ? `${session.width} × ${session.height}` : "Resolution unavailable";
          return el("article", "history-card",
            el("div", "history-card-topline", members.length > 1
              ? badge(pagesTextLiteral(`${members.length} nearby streams`)) : badge(pagesTextLiteral(session.protocol || "Unknown")),
              el("time", "muted", localizedDateTime(session.started_at_unix))),
            el("strong", "history-card-title", pagesTextLiteral(session.app_name || (members.length > 1 ? "Unnamed application" : session.session_id))),
            el("span", "muted", pagesTextLiteral(session.client_name || session.device_name || "Client unavailable")),
            el("span", "muted", pagesTextLiteral(`${resolution}${session.target_fps ? ` · ${session.target_fps} fps` : ""} · ${session.codec || "Codec unavailable"}`)),
            el("div", "actions", details, ...(members.length === 1 ? [memberControls] : [])),
            ...(members.length > 1 ? [memberControls] : []));
        });
        deleteControls = currentDeleteControls;
        applyHistoryDeleteAvailability();
        savedArea.replaceChildren(
          deleteNotice,
          ...(groups.some((members) => members.length > 1) ? [el("p", "muted", "Nearby streams with matching names are grouped on this page; a reconnect is not confirmed.")] : []),
          reply.sessions.length
            ? el("div", "history-card-grid", ...cards)
            : empty("No recorded streams", "Completed streams appear here when history recording is enabled."),
          pager(
            savedHistory.length > 1
              ? () => {
                  savedHistory.pop();
                  savedOffset = savedHistory[savedHistory.length - 1] ?? 0;
                  void loadSaved();
                }
              : null,
            reply.next_offset != null
              ? () => {
                  savedOffset = reply.next_offset!;
                  savedHistory.push(savedOffset);
                  void loadSaved();
                }
              : null,
            pagesTextLiteral(`Showing from ${savedOffset + 1}`),
          ),
        );
      } catch (error) {
        if (context.content.isConnected && request === savedListRequest)
          savedArea.replaceChildren(errorPanel(error, loadSaved));
      }
    }

    async function loadSavedDetail(sessionId: string): Promise<void> {
      selectedSavedSessions = new Set([sessionId]);
      const request = ++savedDetailRequest;
      ++timelineRequest;
      savedDetail.replaceChildren(el("p", "muted", "Loading session details…"));
      try {
        const reply = parseHistoryDetailReply(await context.api.post<unknown>(
          "history/session_detail",
          { session_id: sessionId },
        ), sessionId);
        if (!context.content.isConnected || request !== savedDetailRequest) return;
        const detail = reply.detail;
        if (!detail) return;
        const close = () => {
          ++savedDetailRequest;
          ++timelineRequest;
          selectedSavedSessions.clear();
          savedDetail.replaceChildren();
        };
        const complete = !detail.samples_truncated && !detail.events_truncated;
        let view = renderRecordedSessionDetail(detail, close, complete, undefined, context.ui);
        const timelineStatus = el("div", "recorded-timeline-status");
        savedDetail.replaceChildren(timelineStatus, view);
        if (!complete) {
          let engaged = false;
          const markEngaged = () => { engaged = true; };
          for (const event of ["pointerdown", "keydown", "input", "change"])
            view.addEventListener(event, markEngaged);
          function installComplete(full: NonNullable<HistoryDetailReply["detail"]>): void {
            view = renderRecordedSessionDetail(full, close, true, undefined, context.ui);
            timelineStatus.replaceChildren(el("p", "muted", "All retained history in the captured snapshot is loaded."));
            savedDetail.replaceChildren(timelineStatus, view);
          }
          async function loadTimeline(): Promise<void> {
            const timeline = ++timelineRequest;
            const active = () => context.content.isConnected && request === savedDetailRequest && timeline === timelineRequest;
            const progress = el("p", "muted", "Loading retained history…");
            progress.setAttribute("role", "status");
            const cancel = button("Cancel history loading", () => {
              if (!active()) return;
              ++timelineRequest;
              timelineStatus.replaceChildren(el("p", "muted", "Full history loading was cancelled; the recent snapshot remains available."),
                button("Retry full history", () => void loadTimeline()));
            });
            timelineStatus.replaceChildren(progress, cancel);
            try {
              const full = await loadRetainedTimeline(context.api, sessionId, active, (samples, sampleTotal, events, eventTotal) => {
                if (active()) progress.textContent = `Loading retained history… ${samples} of ${sampleTotal} samples · ${events} of ${eventTotal} events`;
              });
              if (!active() || !full) return;
              const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
              const viewingSelection = !!selection && !selection.isCollapsed && !!selection.anchorNode && view.contains(selection.anchorNode);
              if (engaged || viewingSelection || (document.activeElement && view.contains(document.activeElement))) {
                timelineStatus.replaceChildren(el("p", "muted", "Full retained history is ready."),
                  button("Show full retained history", () => { if (active()) installComplete(full); }));
              } else installComplete(full);
            } catch (error) {
              if (active()) timelineStatus.replaceChildren(errorPanel(error, () => void loadTimeline()),
                el("p", "muted", "The recent snapshot remains available; no partial full-history result was applied."));
            }
          }
          void loadTimeline();
        }
      } catch (error) {
        if (context.content.isConnected && request === savedDetailRequest)
          savedDetail.replaceChildren(errorPanel(error, () => loadSavedDetail(sessionId)));
      }
    }

    async function loadSavedGroup(members: HistorySessionSummary[]): Promise<void> {
      selectedSavedSessions = new Set(members.map((member) => member.session_id));
      const request = ++savedDetailRequest;
      ++timelineRequest;
      savedDetail.replaceChildren(el("p", "muted", "Loading nearby stream details…"));
      let halted = false;
      const current = () => !halted && context.content.isConnected && request === savedDetailRequest;
      try {
        const details: NonNullable<HistoryDetailReply["detail"]>[] = new Array(members.length);
        let next = 0;
        async function readDetails(): Promise<void> {
          while (current() && next < members.length) {
            const index = next++;
            const id = members[index]!.session_id;
            details[index] = parseHistoryDetailReply(await context.api.post<unknown>(
              "history/session_detail", { session_id:id },
            ), id).detail!;
          }
        }
        try { await Promise.all(Array.from({length:Math.min(3, members.length)}, () => readDetails())); }
        catch (error) { halted = true; throw error; }
        if (!current()) return;
        if (groupRecordedSessions(details.map((detail) => detail.session)).length !== 1)
          throw new Error("These streams no longer match this group. Refresh the session list.");
        const close = () => {
          ++savedDetailRequest;
          ++timelineRequest;
          selectedSavedSessions.clear();
          savedDetail.replaceChildren();
        };
        const complete = details.every((detail) => !detail.samples_truncated && !detail.events_truncated);
        let view = renderRecordedSessionDetail(mergeRecordedSessionDetails(details), close, complete, details, context.ui);
        const timelineStatus = el("div", "recorded-timeline-status");
        savedDetail.replaceChildren(timelineStatus, view);
        if (complete) return;
        let engaged = false;
        const markEngaged = () => { engaged = true; };
        for (const event of ["pointerdown", "keydown", "input", "change"]) view.addEventListener(event, markEngaged);
        function withinLimit(samples: number[], events: number[]): boolean {
          return samples.reduce((sum, value) => sum + value, 0) <= 25_000 &&
            events.reduce((sum, value) => sum + value, 0) <= 5_000;
        }
        function installComplete(full: NonNullable<HistoryDetailReply["detail"]>[]): void {
          view = renderRecordedSessionDetail(mergeRecordedSessionDetails(full), close, true, full, context.ui);
          timelineStatus.replaceChildren(el("p", "muted", "All retained history in each captured stream snapshot is loaded."));
          savedDetail.replaceChildren(timelineStatus, view);
        }
        async function loadTimelines(): Promise<void> {
          const timeline = ++timelineRequest;
          let stopped = false;
          const active = () => current() && !stopped && timeline === timelineRequest;
          const sampleTotals = details.map((detail) => detail.sample_count);
          const eventTotals = details.map((detail) => detail.event_count);
          if (!withinLimit(sampleTotals, eventTotals)) {
            timelineStatus.replaceChildren(el("p", "notice", "This group exceeds the browser limit for a complete history. Recent snapshots remain available; open an individual stream for its full history."));
            return;
          }
          const progress = el("p", "muted", "Loading retained history for nearby streams…");
          progress.setAttribute("role", "status");
          const cancel = button("Cancel history loading", () => {
            if (!active()) return;
            ++timelineRequest;
            timelineStatus.replaceChildren(el("p", "muted", "Full history loading was cancelled; recent snapshots remain available."),
              button("Retry full history", () => void loadTimelines()));
          });
          timelineStatus.replaceChildren(progress, cancel);
          const full = [...details];
          let index = 0;
          let done = 0;
          async function readTimeline(): Promise<void> {
            while (active() && index < full.length) {
              const position = index++;
              const detail = full[position]!;
              if (detail.samples_truncated || detail.events_truncated) {
                const loaded = await loadRetainedTimeline(context.api, detail.session.session_id, active, (_samples, sampleTotal, _events, eventTotal) => {
                  sampleTotals[position] = sampleTotal;
                  eventTotals[position] = eventTotal;
                  if (!withinLimit(sampleTotals, eventTotals)) throw new Error("This group exceeds the browser limit for a complete history. Open an individual stream instead.");
                });
                if (!active() || !loaded) return;
                full[position] = loaded;
              }
              done++;
              if (active()) progress.textContent = `Loading retained history… ${done} of ${full.length} streams`;
            }
          }
          try {
            try { await Promise.all(Array.from({length:Math.min(3, full.length)}, () => readTimeline())); }
            catch (error) { stopped = true; throw error; }
            if (!active()) return;
            if (groupRecordedSessions(full.map((detail) => detail.session)).length !== 1)
              throw new Error("These streams no longer match this group. Refresh the session list.");
            const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
            const viewingSelection = !!selection && !selection.isCollapsed && !!selection.anchorNode && view.contains(selection.anchorNode);
            if (engaged || viewingSelection || (document.activeElement && view.contains(document.activeElement))) {
              timelineStatus.replaceChildren(el("p", "muted", "Full retained history is ready for all streams."),
                button("Show full retained history", () => { if (active()) installComplete(full); }));
            } else installComplete(full);
          } catch (error) {
            if (current() && timeline === timelineRequest) timelineStatus.replaceChildren(errorPanel(error, () => void loadTimelines()),
              el("p", "muted", "Recent snapshots remain available; no partial full-history result was applied."));
          }
        }
        void loadTimelines();
      } catch (error) {
        if (context.content.isConnected && request === savedDetailRequest)
          savedDetail.replaceChildren(errorPanel(error, () => loadSavedGroup(members)));
      }
    }
    void loadHistoryRuntime();
    void loadSaved();
    if (context.api.allows("diagnostics.read") || context.api.allows("session.read")) renderHostMetricsDashboard(context, metricsArea, savedHistoryPanel);
    else metricsArea.replaceChildren(panel("Live host metrics", el("p", "muted", "Host metrics are unavailable for this account.")));
  }


}
