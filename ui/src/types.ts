namespace Amaterasu {
  export interface HistorySettingsReply {
    ok: boolean;
    settings: {
      enabled: boolean;
      ttl_days: number;
      db_size_limit_mb: number;
    };
    revision: number;
    effective_enabled: boolean;
  }
  export interface HistorySessionSummary {
    session_id: string;
    protocol: string;
    client_name: string;
    device_name: string;
    app_name: string;
    width: number;
    height: number;
    target_fps: number;
    target_bitrate_kbps: number;
    codec: string;
    started_at_unix: number;
    ended_at_unix: number | null;
    duration_seconds: number | null;
  }
  export interface HistoryListReply {
    ok: boolean;
    sessions: HistorySessionSummary[];
    next_offset: number | null;
  }
  export interface HistoryRuntimeStatus {
    available: boolean;
    configuration_ready: boolean;
    applied_revision: number | null;
    enabled: boolean;
    effective_enabled: boolean;
    degraded: boolean;
    failed_operations: number;
    active_streams: number;
    pending_activities: number;
    sessions: number;
    samples: number;
    events: number;
    live_bytes: number;
    last_prune: {
      sessions_deleted: number;
      live_bytes: number;
      size_limit_bytes: number;
      size_limit_unmet: boolean;
    };
  }
  export interface HistoryDetailReply {
    ok: boolean;
    detail: {
      session: HistorySessionSummary;
      sample_count: number;
      event_count: number;
      samples_truncated: boolean;
      events_truncated: boolean;
      samples: {
        session_id: string;
        recorded_at_unix: number;
        frames_sent: number;
        bytes_sent: number;
        dropped_frames: number;
        actual_fps: number;
        actual_bitrate_kbps: number;
        encode_latency_ms?: number | null;
      }[];
      events: {
        session_id: string;
        recorded_at_unix: number;
        event_type: string;
        payload: unknown | null;
      }[];
    } | null;
  }
  export type Payload = Record<string, unknown>;
  export type TextValue = string;
  export type PageRoute = string;
  export interface Api {
    post<T>(route: string, payload?: Payload, authenticated?: boolean, signal?: AbortSignal): Promise<T>;
    allows(scope: string): boolean;
  }
  export interface PageContext {
    api: Api; content: HTMLElement;
    notify(message: TextValue): void;
    navigate(page: string): void;
    ui: StatsUi;
    setBusy?(key: object, busy: boolean): void;
    registerDraftGuard?(dirty: () => boolean, dispose: () => void): () => void;
  }
  export interface StatsUi {
    dialog?(options: {title:string;description?:string;content?:Node[];onClose?:(reason:string)=>void}): {open():void;dispose():void};
    metricGauge(options: {label: string; value: number | null; detail?: string}): {element: HTMLElement; setValue?(value: number | null, detail?: string): void; dispose?(): void};
    metricChart(options: {label: string; unit: string; minimum?: number; maximum?: number; series: {id: string; label: string; points: {time: number; value: number | null}[]}[]}): {element: HTMLElement; setData?(series: {id: string; label: string; points: {time: number; value: number | null}[]}[]): void; dispose?(): void};
  }
}
