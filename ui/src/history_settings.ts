namespace Amaterasu {
  const maxHistoryLimit = 0x7fffffff;
  const settingsTextLiteral = literalText;


  export function parseHistorySettings(
    enabled: unknown,
    ttlDays: unknown,
    sizeLimitMb: unknown,
  ): HistorySettingsReply["settings"] {
    if (
      typeof enabled !== "boolean" ||
      typeof ttlDays !== "number" ||
      !Number.isSafeInteger(ttlDays) ||
      ttlDays < 0 ||
      ttlDays > maxHistoryLimit ||
      typeof sizeLimitMb !== "number" ||
      !Number.isSafeInteger(sizeLimitMb) ||
      sizeLimitMb < 0 ||
      sizeLimitMb > maxHistoryLimit
    )
      throw new Error("History limits must be whole numbers from 0 to 2147483647.");
    return { enabled, ttl_days: ttlDays, db_size_limit_mb: sizeLimitMb };
  }


  export function parseHistorySettingsReply(value: unknown): HistorySettingsReply {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("Session history settings reply is invalid.");
    const reply = value as Record<string, unknown>;
    if (reply.ok !== true)
      throw new Error("Session history settings reply must report success.");
    if (reply.settings === null || typeof reply.settings !== "object" || Array.isArray(reply.settings))
      throw new Error("Session history settings reply contains invalid settings.");
    if (
      typeof reply.revision !== "number" ||
      !Number.isSafeInteger(reply.revision) ||
      reply.revision < 0
    )
      throw new Error("Session history settings revision must be a nonnegative safe integer.");
    if (typeof reply.effective_enabled !== "boolean")
      throw new Error("Session history effective enabled state must be a boolean.");

    const settings = reply.settings as Record<string, unknown>;
    return {
      ok: true,
      settings: parseHistorySettings(settings.enabled, settings.ttl_days, settings.db_size_limit_mb),
      revision: reply.revision,
      effective_enabled: reply.effective_enabled,
    };
  }


  export async function saveHistorySettings(
    api: Pick<Api, "post">,
    current: HistorySettingsReply,
    enabled: boolean,
    ttlDays: number,
    sizeLimitMb: number,
  ): Promise<HistorySettingsReply> {
    const settings = parseHistorySettings(enabled, ttlDays, sizeLimitMb);
    const updateReply = await api.post<unknown>("history/settings_update", {
      settings,
      expected_revision: current.revision,
    });
    if (updateReply && typeof updateReply === "object" &&
        (updateReply as Record<string, unknown>).code === "revision_conflict")
      throw new Error("Session history settings changed in another editor. Refresh and try again.");
    const updated = parseHistorySettingsReply(updateReply);
    if (updated.revision !== current.revision + 1 ||
        updated.settings.enabled !== settings.enabled ||
        updated.settings.ttl_days !== settings.ttl_days ||
        updated.settings.db_size_limit_mb !== settings.db_size_limit_mb)
      throw new Error("Session history update did not confirm the requested settings. Refresh and check the current values.");
    const saved = parseHistorySettingsReply(await api.post<unknown>("history/settings_get"));
    if (saved.revision !== current.revision + 1 ||
        saved.settings.enabled !== settings.enabled ||
        saved.settings.ttl_days !== settings.ttl_days ||
        saved.settings.db_size_limit_mb !== settings.db_size_limit_mb)
      throw new Error("Session history settings could not be confirmed after saving. Refresh and check the current values.");
    return saved;
  }


  export async function readHistorySettingsState(
    api: Pick<Api, "post">,
  ): Promise<{ settings: HistorySettingsReply; runtime: HistoryRuntimeStatus | null }> {
    const settings = parseHistorySettingsReply(await api.post<unknown>("history/settings_get"));
    return { settings, runtime: await readHistoryRuntime(api) };
  }


  export class HistorySettingsLoadGate {
    private generation = 0;

    invalidate(): void {
      this.generation += 1;
    }

    async read(api: Pick<Api, "post">): Promise<{
      settings: HistorySettingsReply;
      runtime: HistoryRuntimeStatus | null;
    } | null> {
      const generation = ++this.generation;
      try {
        const state = await readHistorySettingsState(api);
        return generation === this.generation ? state : null;
      } catch (error) {
        if (generation !== this.generation) return null;
        throw error;
      }
    }
  }


  async function readHistoryRuntime(api: Pick<Api, "post">): Promise<HistoryRuntimeStatus | null> {
    try {
      return Amaterasu.parseHistoryRuntimeStatus(await api.post<unknown>("history/history_status"));
    } catch {
      return null;
    }
  }


  export async function saveHistorySettingsState(
    api: Pick<Api, "post">,
    current: HistorySettingsReply,
    enabled: boolean,
    ttlDays: number,
    sizeLimitMb: number,
  ): Promise<{ settings: HistorySettingsReply; runtime: HistoryRuntimeStatus | null }> {
    const settings = await saveHistorySettings(api, current, enabled, ttlDays, sizeLimitMb);
    return { settings, runtime: await readHistoryRuntime(api) };
  }


  export function historySettingsRuntimeDescription(
    settings: HistorySettingsReply,
    runtime: HistoryRuntimeStatus | null,
  ): string {
    const saved = `Saved history settings revision ${settings.revision} confirmed.`;
    if (runtime === null)
      return `${saved} Runtime status is unavailable; recording is not confirmed.`;
    if (!runtime.available)
      return `${saved} History storage is unavailable; runtime application is not confirmed.`;
    if (!runtime.configuration_ready)
      return `${saved} History configuration is not ready; runtime application is not confirmed.`;
    if (runtime.applied_revision === null)
      return `${saved} Runtime applied revision is unavailable; recording is not confirmed.`;
    if (runtime.applied_revision > settings.revision)
      return `${saved} Runtime reports newer applied revision ${runtime.applied_revision}; this settings readback is stale. Refresh to check the current settings.`;
    if (runtime.enabled !== settings.settings.enabled)
      return `${saved} Runtime reports a different recording policy from this saved readback; refresh to check the current settings.`;
    if (runtime.applied_revision < settings.revision) {
      const deferred = runtime.effective_enabled !== runtime.enabled &&
        (runtime.active_streams > 0 || runtime.pending_activities > 0);
      const policy = deferred ? ` ${Amaterasu.historyRecordingPolicyDescription(runtime)} ${Amaterasu.historyActivityDescription(runtime)}.` : "";
      return `${saved} Runtime status is stale: applied revision ${runtime.applied_revision} is behind; recording at saved revision ${settings.revision} is not confirmed.${policy}`;
    }
    const policy = Amaterasu.historyRecordingPolicyDescription(runtime);
    const activity = ` ${Amaterasu.historyActivityDescription(runtime)}.`;
    const retention = runtime.effective_enabled
      ? ""
      : " Stored sessions remain readable. Automatic retention and deletion are paused until recording is enabled.";
    return runtime.degraded
      ? `${saved} Runtime applied revision ${runtime.applied_revision} confirmed. ${policy}${activity}${retention} History runtime is degraded; check failed operations and retention status.`
      : `${saved} Runtime applied revision ${runtime.applied_revision} confirmed. ${policy}${activity}${retention}`;
  }
  export function renderHistorySettings(context: PageContext, historyArea: HTMLElement): void {
    const historyLoads = new HistorySettingsLoadGate();
    async function loadHistorySettings(): Promise<void> {
      historyArea.replaceChildren(el("p", "muted", "Loading session history settings…"));
      try {
        const state = await historyLoads.read(context.api);
        if (state === null) return;
        const { settings: reply, runtime } = state;
        if (!context.content.isConnected) return;
        const form = el("form", "settings-form");
        const enabled = input("session_history_enabled", "", "checkbox");
        enabled.checked = reply.settings.enabled;
        const ttl = input(
          "session_history_ttl_days",
          String(reply.settings.ttl_days),
          "number",
        );
        const size = input(
          "session_history_db_size_limit_mb",
          String(reply.settings.db_size_limit_mb),
          "number",
        );
        for (const control of [ttl, size]) {
          control.required = true;
          control.min = "0";
          control.max = String(maxHistoryLimit);
          control.step = "1";
        }
        const ttlField = field(
          "Keep ended sessions for (days)",
          ttl,
          "Zero disables age pruning.",
        );
        const sizeField = field(
          "Approximate live database limit (MiB)",
          size,
          "Zero disables size pruning. Active sessions are never deleted to meet this limit.",
        );
        const status = el(
          "p",
          "muted",
          historySettingsRuntimeDescription(reply, runtime),
        );
        const save = el("button", "button primary", "Save history settings");
        save.type = "submit";
        save.disabled = !context.api.allows("configuration.write");
        form.append(
          field(
            "Record session history",
            enabled,
            "Recording changes wait for active streams to end and pending launches to resolve. Check the runtime status for the effective policy.",
          ),
          el("p", "muted", "Retention limits are saved while recording is disabled. Stored sessions remain readable, but automatic pruning and deletion resume only after recording is enabled."),
          ttlField,
          sizeField,
          status,
          el("div", "actions", save, badge(settingsTextLiteral(`Revision ${reply.revision}`))),
        );
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          context.setBusy?.(save, true);
          void runAction(save, status, async () => {
            historyLoads.invalidate();
            const updated = await saveHistorySettingsState(
              context.api,
              reply,
              enabled.checked,
              ttl.valueAsNumber,
              size.valueAsNumber,
            );
            context.notify(historySettingsRuntimeDescription(updated.settings, updated.runtime));
            await loadHistorySettings();
          }).finally(() => context.setBusy?.(save, false));
        });
        historyArea.replaceChildren(panel("Session history", form));
      } catch (error) {
        if (context.content.isConnected)
          historyArea.replaceChildren(errorPanel(error, loadHistorySettings));
      }
    }


    void loadHistorySettings();
  }
}
