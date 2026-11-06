namespace Amaterasu {
  interface PluginSdk {
    signal: AbortSignal; features: readonly string[]; ui: StatsUi;
    assets: {stylesheet(path: string): Promise<void>};
    canCall(method: string): boolean;
    call(method: string, payload?: Payload): Promise<unknown>;
    setDirty(value: boolean): void;
    setBusy(value: boolean): void;
  }
  const routes: Record<string, [string, string]> = {
    "host-metrics/settings": ["preferences", "configuration.read"],
    "host-metrics/settings_update": ["preferences_update", "configuration.write"],
    "host-metrics/stats": ["host", "diagnostics.read"],
    "live-streams/stop": ["stream_stop", "session.write"],
    "live-streams/status": ["streams", "session.read"],
    "history/settings_get": ["history_preferences", "configuration.read"],
    "history/settings_update": ["history_preferences_update", "configuration.write"],
    "history/history_status": ["history_status", "session.read"],
    "history/list_sessions": ["history_list", "session.read"],
    "history/session_detail": ["history_detail", "session.read"],
    "history/timeline_open": ["timeline_open", "session.read"],
    "history/timeline_page": ["timeline_page", "session.read"],
    "history/delete_session": ["history_delete", "session.write"],
  };
  function mount(container: HTMLElement, sdk: PluginSdk, placement: "page" | "overview" | "settings"): () => void {
    let disposed = false;
    const cleanups = new Set<() => void>();
    const root = el("div", "stats-plugin"); container.append(root);
    const notice = el("p", "stats-notice"); notice.setAttribute("role", "status"); root.append(notice);
    const visuals = new Set<{element:HTMLElement;dispose?():void}>();
    const track = <T extends {element:HTMLElement;dispose?():void}>(control: T): T => {
      visuals.add(control);
      queueMicrotask(() => { if (!root.contains(control.element)) {control.dispose?.();visuals.delete(control);} updateDrafts(); });
      return control;
    };
    const forms = new Map<HTMLFormElement,string>();
    const busy = new Set<object>();
    const formState = (form: HTMLFormElement) => JSON.stringify([...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select,textarea")].map(control => [control.name, control instanceof HTMLInputElement && ["checkbox","radio"].includes(control.type) ? control.checked : control.value]));
    const updateDrafts = () => {
      for (const form of root.querySelectorAll("form")) if (!forms.has(form)) forms.set(form,formState(form));
      for (const form of forms.keys()) if (!root.contains(form)) forms.delete(form);
      sdk.setDirty([...forms].some(([form,initial]) => formState(form) !== initial));
    };
    root.addEventListener("input",updateDrafts); root.addEventListener("change",updateDrafts);
    const observer = new MutationObserver(() => { for (const control of visuals) if (!root.contains(control.element)) {control.dispose?.();visuals.delete(control);} updateDrafts(); });
    observer.observe(root,{childList:true,subtree:true});
    const ui: StatsUi = {
      ...(sdk.ui.dialog ? {dialog: (options: Parameters<NonNullable<StatsUi["dialog"]>>[0]) => sdk.ui.dialog!(options)} : {}),
      metricGauge: options => track(sdk.ui.metricGauge(options)),
      metricChart: options => track(sdk.ui.metricChart(options)),
    };
    const context: PageContext = {
      content: root, ui,
      setBusy(key,value) {if(value) busy.add(key); else busy.delete(key);sdk.setBusy(busy.size>0);},
      api: {
        allows(scope) { return Object.values(routes).some(([alias, grant]) => grant === scope && sdk.canCall(alias)); },
        async post<T>(route: string, payload: Payload = {}): Promise<T> {
          const spec = routes[route];
          if (!spec || disposed || sdk.signal.aborted) throw new Error("Plugin method is unavailable.");
          const result = await sdk.call(spec[0], payload);
          if (disposed || sdk.signal.aborted) throw new Error("Plugin surface closed.");
          if (result && typeof result === "object" && (result as Payload).ok === false) {
            const error = new Error(String((result as Payload).message ?? "Request failed."));
            Object.assign(error, { code: (result as Payload).code }); throw error;
          }
          return result as T;
        },
      },
      notify(message) { if (!disposed) notice.textContent = message; },
      navigate() {},
      registerDraftGuard(_dirty, cleanup) { cleanups.add(cleanup); return () => cleanups.delete(cleanup); },
    };
    const dispose = () => { if (disposed) return; disposed = true; observer.disconnect(); for (const control of visuals) control.dispose?.(); visuals.clear(); for (const cleanup of cleanups) cleanup(); root.replaceChildren(); root.remove(); };
    sdk.signal.addEventListener("abort", dispose, { once: true });
    void sdk.assets.stylesheet("stats.css").then(() => {
      if (disposed || sdk.signal.aborted) return;
      if (!sdk.features.includes("ui.charts/1")) throw new Error("Statistics requires the charts SDK.");
      if (placement === "overview") renderHostMetricsDashboard(context, root, undefined, "overview");
      else if (placement === "settings") { const telemetry = el("div"),history = el("div");root.append(telemetry,history);renderHostMetricsSettings(context, telemetry);renderHistorySettings(context,history); }
      else {
        renderSessions(context);
        const settings = el("details", "stats-preferences", el("summary", "", "Statistics preferences"));
        root.append(settings); const telemetry=el("div"),history=el("div");settings.append(telemetry,history);renderHostMetricsSettings(context, telemetry);renderHistorySettings(context,history);
      }
    }).catch(error => { if (!disposed) root.replaceChildren(errorPanel(error)); });
    return dispose;
  }
  (window as unknown as {AmaterasuExtensions: {v1: {register(id: string, extension: unknown): void}}}).AmaterasuExtensions.v1.register("stats", {
    title: "Statistics",
    mount: (container: HTMLElement, sdk: PluginSdk) => mount(container, sdk, "page"),
    mountOverview: (container: HTMLElement, sdk: PluginSdk) => mount(container, sdk, "overview"),
    mountSettings: (container: HTMLElement, sdk: PluginSdk) => mount(container, sdk, "settings"),
  });
}
