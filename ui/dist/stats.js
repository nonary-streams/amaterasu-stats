(function(){
"use strict";
var Amaterasu;
(function (Amaterasu) {
    Amaterasu.literalText = (value) => value;
    Amaterasu.localizedMessage = Amaterasu.literalText;
    Amaterasu.activeIntlLocale = () => (typeof navigator === "undefined" ? "en" : navigator.language);
    Amaterasu.localeFormattedTextNode = (format) => typeof document.createTextNode === "function" ? document.createTextNode(format(Amaterasu.activeIntlLocale())) : format(Amaterasu.activeIntlLocale());
    Amaterasu.setLocalizedTextContent = (node, text) => { node.textContent = text; };
    Amaterasu.setLocalizedAttributeTemplate = (node, name, template, values) => {
        node.setAttribute(name, template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)));
    };
    function el(tag, className = "", ...children) {
        const element = document.createElement(tag);
        element.className = className;
        for (const child of children)
            if (child != null)
                element.append(child);
        return element;
    }
    Amaterasu.el = el;
    function button(label, action, kind = "secondary") {
        const node = el("button", `button ${kind}`, label);
        node.type = "button";
        node.addEventListener("click", () => { void action(); });
        return node;
    }
    Amaterasu.button = button;
    function field(label, control, hint) { return el("label", "field", el("span", "field-label", label), control, hint ? el("small", "muted", hint) : null); }
    Amaterasu.field = field;
    function input(name, value = "", type = "text") { const node = el("input"); node.name = name; node.value = value; node.type = type; return node; }
    Amaterasu.input = input;
    function panel(title, ...nodes) { return el("section", "panel", el("h2", "", title), ...nodes); }
    Amaterasu.panel = panel;
    function sectionHeading(title, description, ...actions) { return el("header", "page-heading", el("div", "", el("h1", "", title), el("p", "muted", description)), el("div", "actions", ...actions)); }
    Amaterasu.sectionHeading = sectionHeading;
    function empty(title, description, action) { return el("div", "empty-state", el("h3", "", title), el("p", "muted", description), action); }
    Amaterasu.empty = empty;
    function messageOf(error) { return error instanceof Error ? error.message : "The request failed."; }
    Amaterasu.messageOf = messageOf;
    function errorPanel(error, retry) { const node = el("div", "notice error", messageOf(error)); node.setAttribute("role", "alert"); if (retry)
        node.append(button("Try again", retry)); return node; }
    Amaterasu.errorPanel = errorPanel;
    function badge(text, tone = "") { return el("span", `badge ${tone}`, text); }
    Amaterasu.badge = badge;
    function table(headers, rows) { return el("div", "table-scroll", el("table", "", el("thead", "", el("tr", "", ...headers.map(h => { const n = el("th", "", h); n.scope = "col"; return n; }))), el("tbody", "", ...rows.map(row => el("tr", "", ...row.map(value => el("td", "", value))))))); }
    Amaterasu.table = table;
    function pager(back, next, text) { const previous = button("Previous", () => back?.()); previous.disabled = !back; const following = button("Next", () => next?.()); following.disabled = !next; return el("div", "pager", previous, el("span", "", text), following); }
    Amaterasu.pager = pager;
    async function runAction(control, status, action) { control.disabled = true; try {
        await action();
    }
    catch (error) {
        status.replaceChildren(errorPanel(error));
    }
    finally {
        control.disabled = false;
    } }
    Amaterasu.runAction = runAction;
    async function confirmAction(title, description, label, ui) {
        if (ui?.dialog)
            return new Promise(resolve => {
                let settled = false;
                const finish = (answer) => { if (settled)
                    return; settled = true; resolve(answer); dialog.dispose(); };
                const confirm = button(label, () => finish(true), "danger");
                const dialog = ui.dialog({ title, description, content: [confirm], onClose: () => finish(false) });
                dialog.open();
            });
        return new Promise(resolve => {
            const dialog = el("dialog", "stats-confirm");
            const finish = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
            dialog.append(el("h2", "", title), el("p", "", description), button("Cancel", () => finish(false)), button(label, () => finish(true), "danger"));
            dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
            document.body.append(dialog);
            dialog.showModal();
        });
    }
    Amaterasu.confirmAction = confirmAction;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    function parseLiveTiming(value) {
        if (value == null)
            return null;
        if (typeof value !== "object" || Array.isArray(value))
            throw new Error("Encoder timing is invalid.");
        const row = value;
        if (row.version !== 1 || row.scope !== "provider_input_to_output_ready")
            throw new Error("Encoder timing is unsupported.");
        const epoch = liveUnsigned(row.epoch), frames = liveUnsigned(row.completed_frames), total = liveUnsigned(row.total_us);
        const min = liveUnsigned(row.min_us), max = liveUnsigned(row.max_us);
        if (epoch === 0n || max > 60000000n || min > max ||
            (frames === 0n ? total !== 0n || min !== 0n || max !== 0n : total < frames * min || total > frames * max))
            throw new Error("Encoder timing is invalid.");
        return { epoch, frames, total };
    }
    function liveTimingMean(current, previous) {
        if (!current || !previous || current.epoch !== previous.epoch || current.frames <= previous.frames || current.total < previous.total)
            return null;
        const frames = current.frames - previous.frames, total = current.total - previous.total;
        if (total > frames * 60000000n)
            return null;
        return Number(total) / Number(frames) / 1000;
    }
    function liveUnsigned(value) {
        if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
            throw new Error("Live stream counter is invalid.");
        const parsed = BigInt(value);
        if (parsed > 18446744073709551615n)
            throw new Error("Live stream counter is invalid.");
        return parsed;
    }
    function liveUnixMillis(value) {
        if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15}|-[1-9][0-9]{0,15})$/.test(value))
            throw new Error("Live stream observation time is invalid.");
        const parsed = BigInt(value);
        if (parsed < -8640000000000000n || parsed > 8640000000000000n)
            throw new Error("Live stream observation time is invalid.");
        return Number(parsed);
    }
    function parseLiveStreamSnapshot(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Live stream status is invalid.");
        const reply = value;
        if (reply.ok !== true || typeof reply.epoch !== "string" || !/^[0-9a-f]{32}$/.test(reply.epoch) ||
            !Array.isArray(reply.sessions) || reply.sessions.length > 2)
            throw new Error("Live stream status is invalid.");
        const sampledAt = liveUnsigned(reply.sampled_at_ms);
        const sampledAtUnixMs = liveUnixMillis(reply.sampled_at_unix_ms);
        const ids = new Set();
        const streams = reply.sessions.map((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value))
                throw new Error("Live stream status is invalid.");
            const row = value;
            const id = row.session_id;
            if (typeof id !== "string" || !id || new TextEncoder().encode(id).length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(id) || ids.has(id) ||
                !Number.isSafeInteger(row.started_at_unix) ||
                (row.device_name !== null && (typeof row.device_name !== "string" || new TextEncoder().encode(row.device_name).length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(row.device_name))) ||
                !["h264", "hevc", "av1"].includes(String(row.codec)) ||
                ["width", "height", "target_fps", "target_bitrate_kbps"].some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > 0xffff_ffff))
                throw new Error("Live stream metadata is invalid.");
            ids.add(id);
            return {
                session: { session_id: id, started_at_unix: row.started_at_unix, ended_at_unix: null, duration_seconds: null,
                    protocol: "sunshine-modern", client_name: "", device_name: row.device_name ?? "", app_name: "",
                    width: row.width, height: row.height, target_fps: row.target_fps,
                    target_bitrate_kbps: row.target_bitrate_kbps, codec: row.codec },
                counters: { frames: liveUnsigned(row.frames_sent), bytes: liveUnsigned(row.bytes_sent), gaps: liveUnsigned(row.sequence_gaps), timing: parseLiveTiming(row.encode_timing) },
            };
        });
        return { epoch: reply.epoch, sampledAt, sampledAtUnixMs, streams };
    }
    Amaterasu.parseLiveStreamSnapshot = parseLiveStreamSnapshot;
    class LiveStreamTracker {
        entries = new Map();
        epoch = null;
        clear() { this.entries.clear(); this.epoch = null; }
        update(snapshot, retentionSeconds, maxPoints) {
            if (snapshot.epoch !== this.epoch) {
                this.entries.clear();
                this.epoch = snapshot.epoch;
            }
            const active = new Set(snapshot.streams.map((stream) => stream.session.session_id));
            for (const id of this.entries.keys())
                if (!active.has(id))
                    this.entries.delete(id);
            const results = new Map();
            for (const stream of snapshot.streams) {
                const id = stream.session.session_id;
                const old = this.entries.get(id);
                let samples = old?.samples ?? [];
                const monotonic = old && old.startedAt === stream.session.started_at_unix && snapshot.sampledAt >= old.sampledAt &&
                    stream.counters.frames >= old.counters.frames && stream.counters.bytes >= old.counters.bytes && stream.counters.gaps >= old.counters.gaps;
                if (!monotonic)
                    samples = [];
                else if (snapshot.sampledAt > old.sampledAt) {
                    const elapsed = Number(snapshot.sampledAt - old.sampledAt);
                    const wallElapsed = snapshot.sampledAtUnixMs - old.sampledAtUnixMs;
                    if (elapsed > retentionSeconds * 1000 || wallElapsed <= 0 || Math.abs(wallElapsed - elapsed) > 1000)
                        samples = [];
                    else {
                        samples = [...samples, { session_id: id, recorded_at_unix: snapshot.sampledAtUnixMs / 1000,
                                interval_start_unix_ms: old.sampledAtUnixMs, chart_source: "live",
                                frames_sent: Number(stream.counters.frames), bytes_sent: Number(stream.counters.bytes), dropped_frames: Number(stream.counters.gaps),
                                actual_fps: Number(stream.counters.frames - old.counters.frames) * 1000 / elapsed,
                                actual_bitrate_kbps: Number(stream.counters.bytes - old.counters.bytes) * 8 / elapsed,
                                encode_latency_ms: liveTimingMean(stream.counters.timing, old.counters.timing) }];
                    }
                }
                samples = samples.filter((sample) => sample.recorded_at_unix >= snapshot.sampledAtUnixMs / 1000 - retentionSeconds).slice(-maxPoints);
                if (!old || !monotonic || snapshot.sampledAt > old.sampledAt) {
                    this.entries.set(id, { startedAt: stream.session.started_at_unix, sampledAt: snapshot.sampledAt,
                        sampledAtUnixMs: snapshot.sampledAtUnixMs, counters: stream.counters, samples });
                }
                else
                    old.samples = samples;
                const limit = BigInt(Number.MAX_SAFE_INTEGER);
                results.set(id, { detail: { session: stream.session, sample_count: samples.length, event_count: 0,
                        samples_truncated: false, events_truncated: false, samples, events: [] },
                    rounded: stream.counters.frames > limit || stream.counters.bytes > limit || stream.counters.gaps > limit });
            }
            return results;
        }
    }
    Amaterasu.LiveStreamTracker = LiveStreamTracker;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    const TIMELINE_LIMITS = { samples: 25_000, events: 5_000 };
    const TIMELINE_PAGE_LIMITS = { samples: 32, events: 8 };
    function timelineRecord(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("The retained history response is invalid.");
        return value;
    }
    function timelineId(value) {
        if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
            throw new Error("The retained history cursor is invalid.");
        return value;
    }
    function timelineCursor(value) {
        const cursor = timelineRecord(value);
        if (Object.keys(cursor).sort().join(",") !== "after_id,first_id,kind,last_id,session_id,total" ||
            typeof cursor.session_id !== "string" || !cursor.session_id || (cursor.kind !== "samples" && cursor.kind !== "events") ||
            !Number.isSafeInteger(cursor.total) || cursor.total < 1)
            throw new Error("The retained history cursor is invalid.");
        const first = timelineId(cursor.first_id);
        const last = timelineId(cursor.last_id);
        const after = cursor.after_id === null ? null : timelineId(cursor.after_id);
        if (BigInt(first) > BigInt(last) || (after !== null && (BigInt(after) < BigInt(first) || BigInt(after) >= BigInt(last))))
            throw new Error("The retained history cursor is invalid.");
        return { session_id: cursor.session_id, kind: cursor.kind, first_id: first, last_id: last, after_id: after, total: cursor.total };
    }
    function timelineWindow(value, kind, sessionId) {
        const window = timelineRecord(value);
        if (!Number.isSafeInteger(window.total) || window.total < 0)
            throw new Error("The retained history count is invalid.");
        const total = window.total;
        if (total > TIMELINE_LIMITS[kind])
            throw new Error(`This session exceeds the browser limit of ${TIMELINE_LIMITS[kind]} retained ${kind}. The recent snapshot remains available.`);
        if (total === 0 && window.cursor === null)
            return { total, cursor: null };
        const cursor = timelineCursor(window.cursor);
        if (cursor.session_id !== sessionId || cursor.kind !== kind || cursor.total !== total || cursor.after_id !== null)
            throw new Error("The retained history window is inconsistent.");
        return { total, cursor };
    }
    async function loadLiveSampleSnapshot(api, sessionId, limit, previous, active) {
        const opened = timelineRecord(await api.post("history/timeline_open", { session_id: sessionId, sample_limit: limit }));
        if (!active())
            return null;
        if (opened.ok !== true)
            throw new Error("Live sample history is unavailable.");
        const session = Amaterasu.parseHistoryDetailReply({ ok: true, detail: { session: opened.session,
                sample_count: 0, event_count: 0, samples_truncated: false, events_truncated: false, samples: [], events: [] } }, sessionId).detail.session;
        const window = timelineWindow(opened.samples, "samples", sessionId);
        if (window.total > limit)
            throw new Error("The live sample window exceeds its limit.");
        if (!window.cursor)
            return { session, ids: [], samples: [] };
        const boundary = window.cursor;
        let prefix = { session, ids: [], samples: [] };
        if (previous && previous.ids.length === previous.samples.length && previous.session.session_id === sessionId) {
            const keep = previous.ids.map((id, index) => ({ id, sample: previous.samples[index] })).filter(({ id }) => BigInt(id) >= BigInt(boundary.first_id) && BigInt(id) <= BigInt(boundary.last_id));
            if (keep[0]?.id === boundary.first_id && keep.length <= window.total &&
                keep.every(({ id }, index) => index === 0 || BigInt(id) > BigInt(keep[index - 1].id)))
                prefix = { session, ids: keep.map(({ id }) => id), samples: keep.map(({ sample }) => sample) };
        }
        async function read(reuse) {
            const result = { session, ids: [...reuse.ids], samples: [...reuse.samples] };
            const lastKnown = result.ids.at(-1);
            if (lastKnown === boundary.last_id)
                return result.ids.length === window.total ? result : null;
            let cursor = { ...boundary, after_id: lastKnown ?? null };
            while (cursor && active()) {
                const previousCursor = cursor;
                const reply = timelineRecord(await api.post("history/timeline_page", {
                    session_id: sessionId, kind: "samples", cursor, limit: TIMELINE_PAGE_LIMITS.samples,
                }));
                if (!active())
                    return null;
                if (reply.ok !== true || reply.session_id !== sessionId || reply.kind !== "samples" || reply.total !== window.total ||
                    !Array.isArray(reply.entries) || !Array.isArray(reply.entry_ids) || reply.entries.length === 0 ||
                    reply.entries.length > TIMELINE_PAGE_LIMITS.samples || reply.entry_ids.length !== reply.entries.length)
                    throw new Error("The live sample page is invalid.");
                const ids = reply.entry_ids.map(timelineId);
                let last = previousCursor.after_id;
                for (const id of ids) {
                    if (BigInt(id) < BigInt(boundary.first_id) || BigInt(id) > BigInt(boundary.last_id) ||
                        (last !== null && BigInt(id) <= BigInt(last)))
                        throw new Error("The live sample IDs are invalid.");
                    last = id;
                }
                const parsed = Amaterasu.parseHistoryDetailReply({ ok: true, detail: { session,
                        sample_count: reply.entries.length, event_count: 0, samples_truncated: false, events_truncated: false,
                        samples: reply.entries, events: [] } }, sessionId).detail;
                result.ids.push(...ids);
                result.samples.push(...parsed.samples);
                if (result.ids.length > window.total)
                    return null;
                if (reply.next_cursor === null) {
                    if (last !== boundary.last_id)
                        throw new Error("The live sample page ended early.");
                    cursor = null;
                }
                else {
                    const next = timelineCursor(reply.next_cursor);
                    if (next.session_id !== sessionId || next.kind !== "samples" || next.first_id !== boundary.first_id ||
                        next.last_id !== boundary.last_id || next.total !== boundary.total || next.after_id !== last)
                        throw new Error("The live sample cursor is invalid.");
                    cursor = next;
                }
            }
            if (!active())
                return null;
            return result.ids.length === window.total ? result : null;
        }
        let result;
        try {
            result = await read(prefix);
        }
        catch (error) {
            if (!prefix.ids.length || !error || typeof error !== "object" || error.code !== "invalid_request")
                throw error;
            result = null;
        }
        if (!active())
            return null;
        if (!result && prefix.ids.length)
            result = await read({ session, ids: [], samples: [] });
        if (!active())
            return null;
        if (!result)
            throw new Error("The live sample window changed while it was loading.");
        return result;
    }
    Amaterasu.loadLiveSampleSnapshot = loadLiveSampleSnapshot;
    async function loadRetainedTimeline(api, sessionId, active, progress) {
        let halted = false;
        const current = () => !halted && active();
        const opened = timelineRecord(await api.post("history/timeline_open", { session_id: sessionId }));
        if (!current())
            return null;
        if (opened.ok !== true)
            throw new Error("Retained history is unavailable.");
        const session = timelineRecord(opened.session);
        const sampleWindow = timelineWindow(opened.samples, "samples", sessionId);
        const eventWindow = timelineWindow(opened.events, "events", sessionId);
        const metadata = Amaterasu.parseHistoryDetailReply({ ok: true, detail: { session,
                sample_count: 0, event_count: 0, samples_truncated: false, events_truncated: false, samples: [], events: [] } }, sessionId).detail.session;
        const counts = { samples: 0, events: 0 };
        const report = () => { if (current())
            progress(counts.samples, sampleWindow.total, counts.events, eventWindow.total); };
        async function read(kind, window) {
            let cursor = window.cursor;
            const rows = [];
            while (cursor && current()) {
                const previous = cursor;
                const reply = timelineRecord(await api.post("history/timeline_page", {
                    session_id: sessionId, kind, cursor, limit: TIMELINE_PAGE_LIMITS[kind],
                }));
                if (!current())
                    break;
                if (reply.ok !== true || reply.session_id !== sessionId || reply.kind !== kind || reply.total !== window.total ||
                    !Array.isArray(reply.entries) || reply.entries.length === 0 || reply.entries.length > TIMELINE_PAGE_LIMITS[kind])
                    throw new Error("The retained history page is invalid.");
                const entries = reply.entries;
                Amaterasu.parseHistoryDetailReply({ ok: true, detail: { session: metadata,
                        sample_count: kind === "samples" ? entries.length : 0, event_count: kind === "events" ? entries.length : 0,
                        samples_truncated: false, events_truncated: false, samples: kind === "samples" ? entries : [], events: kind === "events" ? entries : [] } }, sessionId);
                rows.push(...entries);
                if (rows.length > window.total)
                    throw new Error("The retained history page exceeds its snapshot.");
                counts[kind] = rows.length;
                report();
                if (reply.next_cursor === null)
                    cursor = null;
                else {
                    const next = timelineCursor(reply.next_cursor);
                    if (next.session_id !== previous.session_id || next.kind !== previous.kind || next.first_id !== previous.first_id || next.last_id !== previous.last_id || next.total !== previous.total ||
                        next.after_id === null || (previous.after_id !== null && BigInt(next.after_id) <= BigInt(previous.after_id)))
                        throw new Error("The retained history cursor did not advance.");
                    cursor = next;
                }
                if ((cursor === null) !== (rows.length === window.total))
                    throw new Error("The retained history page does not match its snapshot count.");
            }
            return rows;
        }
        report();
        try {
            const [samples, events] = await Promise.all([read("samples", sampleWindow), read("events", eventWindow)]);
            if (!current())
                return null;
            return { session: metadata, sample_count: sampleWindow.total, event_count: eventWindow.total,
                samples_truncated: false, events_truncated: false,
                samples: samples, events: events };
        }
        catch (error) {
            halted = true;
            if (!active())
                return null;
            throw error;
        }
    }
    Amaterasu.loadRetainedTimeline = loadRetainedTimeline;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    function groupRecordedSessions(sessions) {
        const groups = [];
        for (const session of sessions) {
            const group = groups.at(-1);
            const newer = group?.at(-1);
            const identityKnown = !!session.protocol.trim() && !!(session.client_name.trim() || session.device_name.trim());
            const matching = newer && identityKnown && newer.protocol === session.protocol &&
                newer.app_name === session.app_name && newer.client_name === session.client_name &&
                newer.device_name === session.device_name;
            const gap = newer && (newer.ended_at_unix === null || newer.ended_at_unix >= newer.started_at_unix) &&
                session.ended_at_unix !== null && session.ended_at_unix >= session.started_at_unix
                ? newer.started_at_unix - session.ended_at_unix : null;
            if (group && matching && gap !== null && gap >= 0 && gap <= 120)
                group.push(session);
            else
                groups.push([session]);
        }
        return groups;
    }
    Amaterasu.groupRecordedSessions = groupRecordedSessions;
    function mergeRecordedSessionDetails(members) {
        if (members.length < 2)
            throw new Error("A grouped history needs at least two streams.");
        const ordered = [...members].sort((a, b) => a.session.started_at_unix - b.session.started_at_unix);
        const first = ordered[0];
        const last = ordered.at(-1);
        const total = (read) => {
            const result = ordered.reduce((sum, member) => sum + read(member), 0);
            if (!Number.isSafeInteger(result))
                throw new Error("Grouped history counts exceed the browser limit.");
            return result;
        };
        const same = (key) => ordered.every((member) => member.session[key] === last.session[key]);
        const duration = ordered.every((member) => member.session.duration_seconds !== null)
            ? total((member) => member.session.duration_seconds) : null;
        return {
            session: { ...last.session, started_at_unix: first.session.started_at_unix, duration_seconds: duration,
                width: same("width") ? last.session.width : 0, height: same("height") ? last.session.height : 0,
                target_fps: same("target_fps") ? last.session.target_fps : 0,
                target_bitrate_kbps: same("target_bitrate_kbps") ? last.session.target_bitrate_kbps : 0,
                codec: same("codec") ? last.session.codec : "" },
            sample_count: total((member) => member.sample_count), event_count: total((member) => member.event_count),
            samples_truncated: ordered.some((member) => member.samples_truncated),
            events_truncated: ordered.some((member) => member.events_truncated),
            samples: ordered.flatMap((member) => member.samples), events: ordered.flatMap((member) => member.events),
        };
    }
    Amaterasu.mergeRecordedSessionDetails = mergeRecordedSessionDetails;
    function historyLiteral(value) {
        return typeof Amaterasu.literalText === "function" ? Amaterasu.literalText(value) : value;
    }
    function historyTime(unixSeconds) {
        const date = new Date(unixSeconds * 1000);
        return typeof Amaterasu.localeFormattedTextNode === "function"
            ? Amaterasu.localeFormattedTextNode((locale) => date.toLocaleString(locale))
            : date.toLocaleString();
    }
    function historyValue(value, unit, digits = 1) {
        return value == null ? "Unavailable" : `${value.toFixed(digits)} ${unit}`;
    }
    const encoderTimingDescription = "Includes encoder queueing, conversion and encoding until coded output is ready. Capture, transfer and display time are separate. Gaps mean unavailable.";
    function historySummaryItem(label, value) {
        return Amaterasu.el("div", "recorded-session-summary-item", Amaterasu.el("dt", "", label), Amaterasu.el("dd", "", value));
    }
    function recordedChart(label, unit, samples, valueOf, source = "recorded") {
        const values = samples.map(valueOf);
        const available = values.filter((value) => value !== null);
        const current = values.at(-1);
        const maximum = Math.max(1, ...available);
        const orderedTime = samples.every((sample, index) => index === 0 ||
            sample.recorded_at_unix > samples[index - 1].recorded_at_unix);
        const start = samples[0]?.recorded_at_unix ?? 0;
        const span = (samples.at(-1)?.recorded_at_unix ?? start) - start;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 320 84");
        svg.setAttribute("width", "320");
        svg.setAttribute("height", "84");
        svg.setAttribute("role", "img");
        const observation = source === "live" ? "observed " : source === "recorded" ? "recorded " : "";
        svg.setAttribute("aria-label", `${label}; ${available.length} ${observation}${available.length === 1 ? "value" : "values"}, latest ${historyValue(current, unit, unit === "gaps" ? 0 : 1)}.`);
        svg.setAttribute("class", "host-metric-chart");
        const axis = document.createElementNS("http://www.w3.org/2000/svg", "path");
        axis.setAttribute("d", "M 0 78 H 320");
        axis.setAttribute("class", "host-metric-chart-axis");
        axis.setAttribute("stroke", "currentColor");
        axis.setAttribute("stroke-opacity", "0.3");
        svg.append(axis);
        const segments = [];
        let segment = [];
        let segmentSource = source === "live" ? "live" : "recorded";
        values.forEach((value, index) => {
            const pointSource = samples[index].chart_source ?? (source === "live" ? "live" : "recorded");
            if (index > 0 && (samples[index].session_id !== samples[index - 1].session_id || pointSource !== segmentSource)) {
                if (segment.length)
                    segments.push({ source: segmentSource, points: segment });
                segment = [];
            }
            if (value === null) {
                if (segment.length)
                    segments.push({ source: segmentSource, points: segment });
                segment = [];
                return;
            }
            segmentSource = pointSource;
            const timestamp = samples[index].recorded_at_unix;
            const x = orderedTime && span > 0
                ? (timestamp - start) / span * 320
                : index / Math.max(samples.length - 1, 1) * 320;
            segment.push({ x, y: 78 - value / maximum * 72 });
        });
        if (segment.length)
            segments.push({ source: segmentSource, points: segment });
        for (const { source: segmentKind, points } of segments) {
            if (points.length === 1) {
                const point = points[0];
                const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", String(point.x));
                dot.setAttribute("cy", String(point.y));
                dot.setAttribute("r", "3");
                dot.setAttribute("class", `host-metric-chart-line${segmentKind === "live" ? " host-metric-chart-live" : ""}`);
                svg.append(dot);
            }
            else {
                const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
                line.setAttribute("class", `host-metric-chart-line${segmentKind === "live" ? " host-metric-chart-live" : ""}`);
                if (segmentKind === "live")
                    line.setAttribute("stroke-dasharray", "4 3");
                line.setAttribute("fill", "none");
                line.setAttribute("stroke", "currentColor");
                line.setAttribute("stroke-width", "2");
                svg.append(line);
            }
        }
        return Amaterasu.el("div", "host-metric-chart-card", Amaterasu.el("div", "host-metric-chart-heading", Amaterasu.el("strong", "", label), Amaterasu.el("span", "", historyLiteral(historyValue(current, unit, unit === "gaps" ? 0 : 1)))), svg, Amaterasu.el("small", "muted", historyLiteral(available.length
            ? `${available.length} ${observation}values · scale 0–${maximum.toFixed(unit === "gaps" ? 0 : 1)} ${unit}`
            : source === "live" ? "No observed values." : "No recorded values.")), ...(label === "Encoder pipeline latency" ? [Amaterasu.el("p", "muted", encoderTimingDescription)] : []));
    }
    function combineActiveSamples(recorded, live, retentionSeconds, maxPoints) {
        const livePoints = live.samples.filter((sample) => sample.chart_source === "live" &&
            Number.isSafeInteger(sample.interval_start_unix_ms) && sample.session_id === live.session.session_id);
        const recordedPoints = (recorded?.samples ?? []).map((sample) => ({ ...sample, chart_source: "recorded" }));
        let note = "";
        let appended = livePoints;
        if (recordedPoints.length) {
            const ordered = recordedPoints.every((sample, index) => sample.session_id === live.session.session_id &&
                (index === 0 || sample.recorded_at_unix > recordedPoints[index - 1].recorded_at_unix));
            const last = recordedPoints.at(-1).recorded_at_unix;
            const boundary = (last + 1) * 1000;
            if (!ordered || !Number.isSafeInteger(boundary) || (livePoints.length > 0 &&
                livePoints.at(-1).recorded_at_unix * 1000 < last * 1000)) {
                appended = [];
                note = "Recorded and live times cannot be safely joined; select Live only for current observations.";
            }
            else {
                appended = livePoints.filter((sample) => sample.interval_start_unix_ms >= boundary);
                if (livePoints.length && !appended.length)
                    note = "Recent live intervals overlap recorded samples; select Live only to inspect them.";
            }
        }
        const combined = [...recordedPoints, ...appended];
        const newest = combined.length ? Math.max(...combined.map((sample) => sample.recorded_at_unix)) : 0;
        const samples = combined.filter((sample) => sample.recorded_at_unix >= newest - retentionSeconds).slice(-maxPoints);
        return { samples, recordedCount: samples.filter((sample) => sample.chart_source === "recorded").length,
            liveCount: samples.filter((sample) => sample.chart_source === "live").length, note };
    }
    Amaterasu.combineActiveSamples = combineActiveSamples;
    function performanceCharts(ui) {
        const views = new Map();
        return (label, unit, samples, valueOf, source = "recorded") => {
            if (!ui || !samples.every((sample, index) => index === 0 || sample.recorded_at_unix > samples[index - 1].recorded_at_unix))
                return recordedChart(label, unit, samples, valueOf, source);
            const points = [];
            const size = Math.max(1, Math.ceil(samples.length / 350));
            for (let start = 0; start < samples.length; start += size) {
                const bucket = samples.slice(start, start + size);
                const numeric = bucket.filter(sample => valueOf(sample) !== null);
                const keep = new Set([bucket[0], bucket.at(-1)]);
                if (numeric.length) {
                    keep.add(numeric.reduce((a, b) => valueOf(a) < valueOf(b) ? a : b));
                    keep.add(numeric.reduce((a, b) => valueOf(a) > valueOf(b) ? a : b));
                }
                const missing = bucket.find(sample => valueOf(sample) === null);
                if (missing)
                    keep.add(missing);
                for (const sample of bucket)
                    if (keep.has(sample))
                        points.push({ time: sample.recorded_at_unix * 1000, value: valueOf(sample) });
            }
            const bounded = points;
            const series = [{ id: label, label, points: bounded }];
            let view = views.get(label);
            if (!view) {
                view = ui.metricChart({ label, unit, minimum: 0, series });
                views.set(label, view);
                if (label === "Encoder pipeline latency")
                    view.element.append(Amaterasu.el("p", "muted", encoderTimingDescription));
            }
            else
                view.setData?.(series);
            return view.element;
        };
    }
    function createLiveSessionCard(ui, stop) {
        const chart = performanceCharts(ui);
        const heading = Amaterasu.el("div");
        const liveSummary = Amaterasu.el("p", "live-session-current");
        const sourceControls = Amaterasu.el("div", "recorded-session-ranges live-session-sources");
        sourceControls.setAttribute("role", "group");
        sourceControls.setAttribute("aria-label", "Stream chart source");
        const controls = Amaterasu.el("div", "recorded-session-ranges");
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", "Live session sample range");
        const status = Amaterasu.el("p", "muted recorded-session-range-status");
        const legend = Amaterasu.el("p", "muted live-session-legend");
        const charts = Amaterasu.el("div");
        const exportButton = Amaterasu.button("Download chart data (CSV)", () => downloadChartCsv(), "quiet");
        const exportStatus = Amaterasu.el("p", "muted");
        exportStatus.setAttribute("role", "status");
        const choices = [];
        const sourceChoices = [];
        let mode = "combined";
        let range = null;
        let live = null;
        let recorded = null;
        let historyNote = "";
        let rounded = false;
        let retentionSeconds = 300;
        let maxPoints = 300;
        let currentPoints = [];
        let currentSession = null;
        function draw() {
            for (const choice of sourceChoices)
                choice.node.setAttribute("aria-pressed", String(choice.mode === mode));
            for (const choice of choices)
                choice.node.setAttribute("aria-pressed", String(choice.minutes === range));
            if (!live) {
                currentPoints = [];
                exportButton.disabled = true;
                charts.replaceChildren();
                return;
            }
            const latestLive = live.samples.at(-1);
            liveSummary.textContent = latestLive
                ? `Latest live rate: ${historyValue(latestLive.actual_fps, "fps")} · ${historyValue(latestLive.actual_bitrate_kbps / 1000, "Mbit/s")} · host observation ${new Date(latestLive.recorded_at_unix * 1000).toLocaleString()}.${rounded ? " Very large counters are rounded for display." : ""}`
                : "Latest live rate: waiting for two host counter readings.";
            if (mode === "recorded" && !recorded) {
                currentPoints = [];
                exportButton.disabled = true;
                status.textContent = historyNote || "Recorded history is unavailable. Select Live only to see current observations.";
                legend.textContent = "";
                charts.replaceChildren();
                return;
            }
            const combined = combineActiveSamples(recorded, live, retentionSeconds, maxPoints);
            const points = mode === "live" ? live.samples : mode === "recorded"
                ? (recorded?.samples ?? []).map((sample) => ({ ...sample, chart_source: "recorded" })) : combined.samples;
            const newest = points.length ? Math.max(...points.map((sample) => sample.recorded_at_unix)) : 0;
            const selectedRange = range;
            const selected = selectedRange === null ? points : points.filter((sample) => sample.recorded_at_unix >= newest - selectedRange * 60);
            currentPoints = selected;
            exportButton.disabled = selected.length === 0;
            const recordedCount = points.filter((sample) => sample.chart_source === "recorded").length;
            const liveCount = points.filter((sample) => sample.chart_source === "live").length;
            const description = mode === "combined" ? `${recordedCount} recorded · ${liveCount} live.`
                : mode === "live" ? "Live observations stay in this browser." : "Recorded samples are retained by the host.";
            status.textContent = `${selected.length} of ${points.length} samples shown. ${description}${mode === "combined" && combined.note ? ` ${combined.note}` : ""}${historyNote ? ` ${historyNote}` : ""}`;
            legend.textContent = mode === "combined" && liveCount ? "Recorded: solid / filled · Live: dashed / hollow" : "";
            if (!selected.length) {
                charts.replaceChildren(Amaterasu.empty("No samples in this range", points.length ? "Choose a longer range." : mode === "recorded" ? "Waiting for recorded samples." : "Waiting for another live counter reading."));
                return;
            }
            const chartSource = mode === "combined" ? "combined" : mode;
            charts.replaceChildren(Amaterasu.el("div", "recorded-session-chart-grid", chart("Accepted video rate", "fps", selected, (sample) => sample.actual_fps, chartSource), chart("Accepted audio/video payload rate", "Mbit/s", selected, (sample) => sample.actual_bitrate_kbps / 1000, chartSource), chart("Encoder pipeline latency", "ms", selected, (sample) => sample.encode_latency_ms ?? null, chartSource), chart("Observed video sequence gaps", "gaps", selected, (sample) => sample.dropped_frames, chartSource)));
        }
        function downloadChartCsv() {
            if (!currentSession || !currentPoints.length)
                return;
            const columns = ["session_id", "recorded_at_unix", "observed_at", "source", "frames_sent", "bytes_sent",
                "dropped_frames", "actual_fps", "actual_bitrate_kbps", "encode_latency_ms"];
            const rows = currentPoints.map((sample) => {
                const observedAt = new Date(sample.recorded_at_unix * 1000);
                return [
                    sample.session_id,
                    sample.recorded_at_unix,
                    Number.isFinite(observedAt.getTime()) ? observedAt.toISOString() : "",
                    sample.chart_source ?? (mode === "live" ? "live" : "recorded"),
                    sample.frames_sent,
                    sample.bytes_sent,
                    sample.dropped_frames,
                    sample.actual_fps,
                    sample.actual_bitrate_kbps,
                    sample.encode_latency_ms,
                ];
            });
            const formulaLeadingText = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u;
            const unsafeLeadingControl = /^[\t\r\n]/;
            const csvCell = (value) => {
                const text = String(value ?? "");
                const spreadsheetSafeText = typeof value === "string" &&
                    (formulaLeadingText.test(text) || unsafeLeadingControl.test(text)) ? `'${text}` : text;
                return `"${spreadsheetSafeText.replaceAll(String.fromCharCode(34), String.fromCharCode(34, 34))}"`;
            };
            const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
            const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            const safeId = currentSession.session_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "stream";
            link.href = objectUrl;
            link.download = `amaterasu-stream-${safeId}.csv`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            exportStatus.textContent = `Downloaded ${currentPoints.length} chart samples as CSV.`;
        }
        for (const [nextMode, label] of [["combined", "History + live"], ["live", "Live only"], ["recorded", "Recorded only"]]) {
            const node = Amaterasu.button(label, () => { mode = nextMode; draw(); }, "recorded-range-button");
            sourceChoices.push({ mode: nextMode, node });
            sourceControls.append(node);
        }
        for (const minutes of [null, 3, 5, 15, 30, 60]) {
            const node = Amaterasu.button(minutes === null ? "Available samples" : `${minutes} min`, () => { range = minutes; draw(); }, "recorded-range-button");
            choices.push({ minutes, node });
            controls.append(node);
        }
        const element = Amaterasu.el("article", "live-session-card", heading, Amaterasu.el("p", "muted", "Host-side accepted media and observed sequence gaps; client delivery is not confirmed."), liveSummary, sourceControls, controls, status, legend, charts, exportButton, exportStatus);
        if (stop) {
            const action = Amaterasu.button("Stop stream", () => Amaterasu.runAction(action, exportStatus, async () => {
                if (currentSession)
                    await stop(currentSession.session_id);
            }), "danger");
            element.append(action);
        }
        return { element, update(session, nextLive, nextRecorded, nextNote, nextRounded, nextRetention, nextMaximum) {
                currentSession = session;
                live = nextLive;
                recorded = nextRecorded;
                historyNote = nextNote;
                rounded = nextRounded;
                retentionSeconds = nextRetention;
                maxPoints = nextMaximum;
                const resolution = session.width && session.height ? `${session.width} × ${session.height}` : "Resolution unavailable";
                const fps = session.target_fps ? ` · ${session.target_fps} fps target` : "";
                const title = session.app_name || session.device_name || "Live stream";
                const client = session.app_name ? session.device_name || session.client_name || "Client unavailable"
                    : session.device_name ? "" : `Stream ${session.session_id}`;
                heading.replaceChildren(Amaterasu.el("div", "live-session-heading", Amaterasu.el("div", "", Amaterasu.el("span", "live-session-label", "Active"), Amaterasu.el("h3", "", historyLiteral(title)), Amaterasu.el("p", "muted", historyLiteral([client, session.protocol || "Protocol unavailable"].filter(Boolean).join(" · ")))), Amaterasu.el("p", "muted", historyLiteral(`${resolution}${fps} · ${session.codec || "Codec unavailable"}`))));
                draw();
            } };
    }
    Amaterasu.createLiveSessionCard = createLiveSessionCard;
    function renderRecordedSessionDetail(detail, close, complete = false, members, ui) {
        const chart = performanceCharts(ui);
        const session = detail.session;
        const chartArea = Amaterasu.el("div");
        const rangeStatus = Amaterasu.el("p", "muted recorded-session-range-status");
        rangeStatus.setAttribute("role", "status");
        const rangeControls = Amaterasu.el("div", "recorded-session-ranges");
        rangeControls.setAttribute("role", "group");
        rangeControls.setAttribute("aria-label", "Recorded sample range");
        const rangeButtons = [];
        const newest = detail.samples.length ? Math.max(...detail.samples.map((sample) => sample.recorded_at_unix)) : 0;
        let range = null;
        function draw() {
            const selectedRange = range;
            const samples = selectedRange === null ? detail.samples : detail.samples.filter((sample) => sample.recorded_at_unix >= newest - selectedRange * 60);
            for (const choice of rangeButtons)
                choice.node.setAttribute("aria-pressed", String(choice.minutes === range));
            if (!samples.length) {
                chartArea.replaceChildren(Amaterasu.empty("No samples in this range", detail.samples.length
                    ? "Choose a longer range to inspect retained samples." : "No samples were recorded for this session."));
                rangeStatus.textContent = "No recorded samples in this range.";
                return;
            }
            const ordered = samples.every((sample, index) => index === 0 || sample.recorded_at_unix > samples[index - 1].recorded_at_unix);
            const spacing = samples.length === 1 ? " · single sample" : ordered
                ? " · time-proportional spacing" : " · evenly spaced in recorded order because timestamps repeat or move backward";
            rangeStatus.textContent = `${samples.length} of ${detail.samples.length} returned samples${spacing}.`;
            chartArea.replaceChildren(Amaterasu.el("div", "recorded-session-chart-grid", chart("Accepted video rate", "fps", samples, (sample) => sample.actual_fps), chart("Accepted audio/video payload rate", "Mbit/s", samples, (sample) => sample.actual_bitrate_kbps / 1000), chart("Encoder pipeline latency", "ms", samples, (sample) => sample.encode_latency_ms ?? null), chart("Observed video sequence gaps", "gaps", samples, (sample) => sample.dropped_frames)));
        }
        for (const minutes of [null, 3, 5, 15, 30, 60]) {
            const node = Amaterasu.button(minutes === null ? "Available samples" : `${minutes} min`, () => { range = minutes; draw(); }, "recorded-range-button");
            rangeButtons.push({ minutes, node });
            rangeControls.append(node);
        }
        const download = Amaterasu.button(complete ? "Download retained history (JSON)" : "Download returned history (JSON)", () => {
            const payload = JSON.stringify(members
                ? { format: "amaterasu-session-history-group/1", scope: complete ? "retained_snapshots" : "recent_snapshots", members }
                : { format: "amaterasu-session-history/1", scope: complete ? "retained_snapshot" : "recent_snapshot", detail }, null, 2);
            const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = members ? "amaterasu-session-history-group.json" : "amaterasu-session-history.json";
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        });
        const resolution = session.width && session.height ? `${session.width} × ${session.height}` : "Unavailable";
        const targetFps = session.target_fps ? `${session.target_fps} fps` : "Unavailable";
        const targetBitrate = session.target_bitrate_kbps ? `${(session.target_bitrate_kbps / 1000).toFixed(1)} Mbit/s` : "Unavailable";
        const duration = session.duration_seconds === null ? (session.ended_at_unix === null ? "Active" : "Unavailable") : `${session.duration_seconds} seconds`;
        const sampleArea = Amaterasu.el("div");
        let samplePage = 0;
        function drawSamples() {
            const start = samplePage * 50;
            const visible = detail.samples.slice(start, start + 50);
            sampleArea.replaceChildren(visible.length ? Amaterasu.table([...(members ? ["Stream"] : []), "Recorded time", "Accepted frames", "Accepted bytes", "Sequence gaps", "Video fps", "Payload kbps", "Encoder pipeline latency"], visible.map((sample) => [...(members ? [historyLiteral(sample.session_id)] : []), historyTime(sample.recorded_at_unix), String(sample.frames_sent), String(sample.bytes_sent),
                String(sample.dropped_frames), sample.actual_fps.toFixed(1), sample.actual_bitrate_kbps.toFixed(1), historyValue(sample.encode_latency_ms, "ms")])) : Amaterasu.el("p", "muted", "No samples recorded."), ...(detail.samples.length > 50 ? [Amaterasu.pager(samplePage > 0 ? () => { samplePage--; drawSamples(); } : null, start + visible.length < detail.samples.length ? () => { samplePage++; drawSamples(); } : null, historyLiteral(`Samples ${start + 1}–${start + visible.length} of ${detail.samples.length}`))] : []));
        }
        drawSamples();
        const sampleDisclosure = Amaterasu.el("details", "recorded-session-disclosure", Amaterasu.el("summary", "", "Sample table"), sampleArea);
        const eventDisclosure = Amaterasu.el("details", "recorded-session-disclosure", Amaterasu.el("summary", "", "Recorded events"));
        const eventArea = Amaterasu.el("div");
        let eventPage = 0;
        function drawEvents() {
            const start = eventPage * 25;
            const visible = detail.events.slice(start, start + 25);
            const rows = visible.map((event) => {
                const row = Amaterasu.el("div", "recorded-session-event", Amaterasu.el("strong", "", historyLiteral(event.event_type)), Amaterasu.el("small", "muted", historyTime(event.recorded_at_unix)), ...(members ? [Amaterasu.el("small", "muted", historyLiteral(`Stream ${event.session_id}`))] : []));
                if (event.payload != null)
                    row.append(Amaterasu.el("details", "", Amaterasu.el("summary", "", "Event details"), Amaterasu.el("pre", "recorded-session-event-payload", historyLiteral(JSON.stringify(event.payload, null, 2)))));
                return row;
            });
            eventArea.replaceChildren(...(rows.length ? rows : [Amaterasu.el("p", "muted", "No events recorded.")]), ...(detail.events.length > 25 ? [Amaterasu.pager(eventPage > 0 ? () => { eventPage--; drawEvents(); } : null, start + visible.length < detail.events.length ? () => { eventPage++; drawEvents(); } : null, historyLiteral(`Events ${start + 1}–${start + visible.length} of ${detail.events.length}`))] : []));
        }
        drawEvents();
        eventDisclosure.append(eventArea);
        const info = Amaterasu.el("dl", "recorded-session-summary", historySummaryItem("Client", historyLiteral(session.client_name || session.device_name || "Unavailable")), historySummaryItem("Protocol", historyLiteral(session.protocol || "Unavailable")), historySummaryItem("Resolution", historyLiteral(resolution)), historySummaryItem("Target frame rate", historyLiteral(targetFps)), historySummaryItem("Target bitrate", historyLiteral(targetBitrate)), historySummaryItem("Codec", historyLiteral(session.codec || "Unavailable")), historySummaryItem(members ? "Total stream time" : "Duration", historyLiteral(duration)), historySummaryItem("Started", historyTime(session.started_at_unix)));
        const heading = Amaterasu.el("div", "recorded-session-heading", Amaterasu.el("div", "", Amaterasu.el("h2", "", historyLiteral(`History for ${session.app_name || (members ? "Unnamed application" : session.session_id)}${members ? ` · ${members.length} nearby streams` : ""}`)), Amaterasu.el("p", "muted", historyLiteral(`${detail.samples.length} of ${detail.sample_count} samples · ${detail.events.length} of ${detail.event_count} events`))), Amaterasu.el("div", "actions", download, Amaterasu.button("Close details", close)));
        const limitation = detail.samples_truncated || detail.events_truncated
            ? Amaterasu.el("p", "notice", "Only the latest returned samples and events are available here and in the JSON download.")
            : Amaterasu.el("p", "muted", complete
                ? members ? "The JSON download contains each retained snapshot regardless of chart range. Older records may have been removed before the snapshots."
                    : "The JSON download contains the retained snapshot regardless of chart range. Older records may have been removed before this snapshot."
                : "The JSON download contains all returned session metadata, samples and events regardless of chart range.");
        const groupNote = members ? Amaterasu.el("p", "muted", "These streams are grouped by matching names and a short time gap; a reconnect is not confirmed. Chart lines stop between streams, and the download preserves each stream separately.") : null;
        const box = Amaterasu.el("section", "panel recorded-session-detail", heading, info, groupNote, limitation, Amaterasu.el("h3", "", "Recorded stream performance"), Amaterasu.el("p", "muted", "Rates and counters describe host-side media accepted by the local transport queue, including audio payload bytes. Sequence gaps are not client-reported loss; client delivery is not confirmed. Zero rates can also represent a zero-duration final sample."), rangeControls, rangeStatus, chartArea, sampleDisclosure, eventDisclosure);
        draw();
        return box;
    }
    Amaterasu.renderRecordedSessionDetail = renderRecordedSessionDetail;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    function hostMetricsTextLiteral(value) {
        return typeof Amaterasu.literalText === "function" ? Amaterasu.literalText(value) : value;
    }
    function hostMetricsTextMessage(value) {
        return typeof Amaterasu.localizedMessage === "function" ? Amaterasu.localizedMessage(value) : value;
    }
    function hostMetricsSetLocalizedTextContent(target, source) {
        if (typeof Amaterasu.setLocalizedTextContent === "function") {
            Amaterasu.setLocalizedTextContent(target, source);
        }
        else {
            target.textContent = source;
        }
    }
    const realtimeDefaults = {
        enabled: true,
        poll_interval_ms: 2_000,
        history_retention_seconds: 300,
        max_history_points: 300,
        pause_when_hidden: true,
        show_active_sessions: true,
        show_host_stats: true,
        show_host_charts: true,
        show_session_history: true,
    };
    const dashboardCleanup = new WeakMap();
    const settingsGeneration = new WeakMap();
    function parseRealtimeSettings(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            throw new Error("Real-time statistics settings are invalid.");
        const settings = value;
        const knownKeys = new Set([
            "enabled", "poll_interval_ms", "history_retention_seconds", "max_history_points",
            "pause_when_hidden", "show_active_sessions", "show_host_stats", "show_host_charts",
            "show_session_history",
        ]);
        if (Object.keys(settings).length !== knownKeys.size || Object.keys(settings).some((key) => !knownKeys.has(key)))
            throw new Error("Real-time statistics settings contain unknown or missing fields.");
        const booleans = [
            "enabled", "pause_when_hidden", "show_active_sessions", "show_host_stats",
            "show_host_charts", "show_session_history",
        ];
        if (booleans.some((key) => typeof settings[key] !== "boolean"))
            throw new Error("Real-time statistics display settings are invalid.");
        const boundedInteger = (key, min, max) => {
            const value = settings[key];
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
                throw new Error(`Real-time statistics ${key} must be a whole number from ${min} to ${max}.`);
            return value;
        };
        return {
            enabled: settings.enabled,
            poll_interval_ms: boundedInteger("poll_interval_ms", 250, 60_000),
            history_retention_seconds: boundedInteger("history_retention_seconds", 30, 3_600),
            max_history_points: boundedInteger("max_history_points", 30, 2_000),
            pause_when_hidden: settings.pause_when_hidden,
            show_active_sessions: settings.show_active_sessions,
            show_host_stats: settings.show_host_stats,
            show_host_charts: settings.show_host_charts,
            show_session_history: settings.show_session_history,
        };
    }
    function parseRealtimeSettingsReply(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Real-time statistics settings reply is invalid.");
        const reply = value;
        if (reply.ok !== true || typeof reply.revision !== "number" ||
            !Number.isSafeInteger(reply.revision) || reply.revision < 0)
            throw new Error("Real-time statistics settings reply is invalid.");
        return {
            ok: true,
            revision: reply.revision,
            settings: parseRealtimeSettings(reply.settings),
        };
    }
    function parseHostSnapshot(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Host metrics snapshot is invalid.");
        const source = value;
        const result = {};
        for (const key of [
            "cpu_percent", "cpu_temp_c", "ram_used_bytes", "ram_total_bytes", "gpu_percent",
            "gpu_encoder_percent", "gpu_temp_c", "vram_used_bytes", "vram_total_bytes",
            "net_rx_bps", "net_tx_bps",
        ]) {
            const metric = source[key];
            if (metric !== null && (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0))
                throw new Error(`Host metric ${key} is invalid.`);
            result[key] = metric;
        }
        return result;
    }
    function parseHostStatsReply(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Host statistics reply is invalid.");
        const reply = value;
        if (reply.ok !== true || typeof reply.available !== "boolean" || typeof reply.platform !== "string" ||
            (reply.sampled_at_unix_ms !== null && (!Number.isSafeInteger(reply.sampled_at_unix_ms) ||
                reply.sampled_at_unix_ms < 0)) || !Array.isArray(reply.samples) || reply.samples.length > 32)
            throw new Error("Host statistics reply is invalid.");
        const samples = reply.samples.map((sample) => {
            if (!sample || typeof sample !== "object" || Array.isArray(sample))
                throw new Error("Host statistics history point is invalid.");
            const point = sample;
            if (!Number.isSafeInteger(point.recorded_at_unix_ms) || point.recorded_at_unix_ms < 0)
                throw new Error("Host statistics history timestamp is invalid.");
            return { recorded_at_unix_ms: point.recorded_at_unix_ms, host: parseHostSnapshot(point.host) };
        });
        return {
            ok: true,
            available: reply.available,
            platform: reply.platform,
            sampled_at_unix_ms: reply.sampled_at_unix_ms,
            host: parseHostSnapshot(reply.host),
            samples,
        };
    }
    async function loadRealtimeSettings(api) {
        return parseRealtimeSettingsReply(await api.post("host-metrics/settings"));
    }
    async function saveRealtimeSettings(api, current, settings) {
        const desired = parseRealtimeSettings(settings);
        const updated = parseRealtimeSettingsReply(await api.post("host-metrics/settings_update", {
            settings: desired,
            expected_revision: current.revision,
        }));
        if (updated.revision !== current.revision + 1 ||
            JSON.stringify(updated.settings) !== JSON.stringify(desired))
            throw new Error("Real-time statistics settings update could not be confirmed. Refresh and check the saved values.");
        const saved = await loadRealtimeSettings(api);
        if (saved.revision !== updated.revision || JSON.stringify(saved.settings) !== JSON.stringify(desired))
            throw new Error("Real-time statistics settings could not be confirmed after saving.");
        return saved;
    }
    function renderHostMetricsSettings(context, container) {
        const generation = (settingsGeneration.get(container) ?? 0) + 1;
        settingsGeneration.set(container, generation);
        let current = null;
        async function load() {
            container.replaceChildren(Amaterasu.el("p", "muted", "Loading real-time statistics settings…"));
            try {
                const loaded = await loadRealtimeSettings(context.api);
                if (!container.isConnected || settingsGeneration.get(container) !== generation)
                    return;
                current = loaded;
                const settings = current.settings;
                const form = Amaterasu.el("form", "settings-form");
                const enabled = Amaterasu.input("realtime_stats_enabled", "", "checkbox");
                enabled.checked = settings.enabled;
                const poll = Amaterasu.input("realtime_stats_poll_interval_ms", String(settings.poll_interval_ms), "number");
                const retention = Amaterasu.input("realtime_stats_history_retention_seconds", String(settings.history_retention_seconds), "number");
                const points = Amaterasu.input("realtime_stats_max_history_points", String(settings.max_history_points), "number");
                for (const control of [poll, retention, points]) {
                    control.required = true;
                    control.step = "1";
                }
                poll.min = "250";
                poll.max = "60000";
                retention.min = "30";
                retention.max = "3600";
                points.min = "30";
                points.max = "2000";
                const pause = Amaterasu.input("realtime_stats_pause_when_hidden", "", "checkbox");
                pause.checked = settings.pause_when_hidden;
                const active = Amaterasu.input("realtime_stats_show_active_sessions", "", "checkbox");
                active.checked = settings.show_active_sessions;
                const hostStats = Amaterasu.input("realtime_stats_show_host_stats", "", "checkbox");
                hostStats.checked = settings.show_host_stats;
                const charts = Amaterasu.input("realtime_stats_show_host_charts", "", "checkbox");
                charts.checked = settings.show_host_charts;
                const sessionHistory = Amaterasu.input("realtime_stats_show_session_history", "", "checkbox");
                sessionHistory.checked = settings.show_session_history;
                const status = Amaterasu.el("p", "muted", hostMetricsTextLiteral(`Saved settings revision ${current.revision}.`));
                const save = Amaterasu.el("button", "button primary", "Save real-time statistics settings");
                save.type = "submit";
                save.disabled = !context.api.allows("configuration.write");
                form.append(Amaterasu.field("Enable real-time statistics", enabled, "Collect measured host metrics for the live statistics dashboard and while an active stream requests samples."), Amaterasu.field("Sampling and dashboard interval (ms)", poll, "250 to 60000 milliseconds."), Amaterasu.field("Chart history retention (seconds)", retention, "30 to 3600 seconds; history is held in memory."), Amaterasu.field("Maximum retained samples", points, "Retain 30 to 2000 measured samples in memory; the live response spreads at most 32 chart points across that history."), Amaterasu.field("Pause after the dashboard is hidden", pause, "When enabled, sampling pauses after the visible dashboard lease expires unless a stream is active."), Amaterasu.field("Show active sessions", active), Amaterasu.field("Show host statistics", hostStats), Amaterasu.field("Show host charts", charts), Amaterasu.field("Show session history", sessionHistory), status, Amaterasu.el("div", "actions", save, Amaterasu.badge(hostMetricsTextLiteral(`Revision ${current.revision}`))));
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    context.setBusy?.(save, true);
                    void Amaterasu.runAction(save, status, async () => {
                        if (!current)
                            throw new Error("Statistics settings must be refreshed before saving.");
                        current = await saveRealtimeSettings(context.api, current, {
                            enabled: enabled.checked,
                            poll_interval_ms: poll.valueAsNumber,
                            history_retention_seconds: retention.valueAsNumber,
                            max_history_points: points.valueAsNumber,
                            pause_when_hidden: pause.checked,
                            show_active_sessions: active.checked,
                            show_host_stats: hostStats.checked,
                            show_host_charts: charts.checked,
                            show_session_history: sessionHistory.checked,
                        });
                        context.notify(`Real-time statistics settings revision ${current.revision} saved.`);
                        await load();
                    }).finally(() => context.setBusy?.(save, false));
                });
                container.replaceChildren(Amaterasu.panel("Real-time statistics", form));
            }
            catch (error) {
                if (container.isConnected && settingsGeneration.get(container) === generation)
                    container.replaceChildren(Amaterasu.errorPanel(error, load));
            }
        }
        void load();
    }
    Amaterasu.renderHostMetricsSettings = renderHostMetricsSettings;
    function renderHostMetricsDashboard(context, container, sessionHistoryContainer, view = "full") {
        dashboardCleanup.get(container)?.();
        let requestGeneration = 0;
        let initializationGeneration = 0;
        let timer;
        let disposed = false;
        let observer;
        let settings = realtimeDefaults;
        let settingsLoaded = false;
        const canReadHost = typeof context.api.allows !== "function" || context.api.allows("diagnostics.read");
        const canReadLive = typeof context.api.allows !== "function" || context.api.allows("session.read");
        const canReadSettings = typeof context.api.allows !== "function" || context.api.allows("configuration.read");
        const area = Amaterasu.el("div");
        const activeArea = Amaterasu.el("div");
        const activeList = Amaterasu.el("div", "live-session-list");
        const activeNote = Amaterasu.el("p", "muted");
        const activePanel = Amaterasu.panel("Active streaming sessions", activeNote, activeList);
        const liveTracker = new Amaterasu.LiveStreamTracker();
        let activeEpoch = null;
        const activeCards = new Map();
        let loadingLiveHistory = false;
        let liveHistoryPending = false;
        const status = Amaterasu.el("p", "muted", "Loading live host metrics…");
        const preferenceNotice = Amaterasu.el("p", "muted");
        container.replaceChildren(Amaterasu.el("div", "host-metrics-toolbar", status, Amaterasu.button("Refresh host metrics", () => void refresh())), preferenceNotice, area, activeArea);
        const cleanup = () => {
            if (disposed)
                return;
            disposed = true;
            ++requestGeneration;
            if (timer !== undefined)
                window.clearTimeout(timer);
            timer = undefined;
            document.removeEventListener("visibilitychange", applyVisibility);
            observer?.disconnect();
            dashboardCleanup.delete(container);
        };
        dashboardCleanup.set(container, cleanup);
        function applyVisibility() {
            if (disposed || !container.isConnected || !settingsLoaded)
                return;
            if (sessionHistoryContainer)
                sessionHistoryContainer.hidden = !settings.show_session_history;
            if (!settings.enabled) {
                renderDisabledState();
                return;
            }
            if (view === "overview" && !settings.show_host_stats)
                return;
            if (settings.pause_when_hidden && document.visibilityState !== "visible") {
                if (timer !== undefined)
                    window.clearTimeout(timer);
                timer = undefined;
            }
            else if (settings.enabled && timer === undefined) {
                timer = window.setTimeout(() => void refresh(), 0);
            }
        }
        async function refresh() {
            if (timer !== undefined)
                window.clearTimeout(timer);
            timer = undefined;
            const request = ++requestGeneration;
            if (disposed || !container.isConnected || !settingsLoaded)
                return;
            if (!settings.enabled) {
                renderDisabledState();
                return;
            }
            if (view === "overview" && !settings.show_host_stats)
                return;
            if (settings.pause_when_hidden && document.visibilityState !== "visible")
                return;
            const current = () => !disposed && container.isConnected && request === requestGeneration &&
                !(settings.pause_when_hidden && document.visibilityState !== "visible");
            await Promise.all([refreshHost(current), refreshActive(current)]);
            if (current())
                schedule();
        }
        async function refreshHost(current) {
            if (!canReadHost) {
                if (current()) {
                    hostMetricsSetLocalizedTextContent(status, "Host telemetry is unavailable for this account.");
                    area.replaceChildren();
                }
                return;
            }
            try {
                const result = parseHostStatsReply(await context.api.post("host-metrics/stats"));
                if (!current())
                    return;
                const panels = [];
                if (settings.show_host_stats) {
                    if (!result.available)
                        panels.push(Amaterasu.panel("Host vitals", Amaterasu.el("p", "muted", "Host telemetry is unavailable on this platform.")));
                    else if (result.sampled_at_unix_ms === null)
                        panels.push(Amaterasu.panel("Host vitals", Amaterasu.el("p", "muted", "Waiting for the first measured host sample.")));
                    else
                        panels.push(renderHostStats(result, context.ui));
                }
                if (view === "full" && settings.show_host_charts)
                    panels.push(renderHostCharts(result.samples, context.ui));
                area.replaceChildren(...panels);
                const locale = typeof Amaterasu.activeIntlLocale === "function"
                    ? Amaterasu.activeIntlLocale()
                    : undefined;
                status.textContent = result.available
                    ? result.sampled_at_unix_ms === null
                        ? `Host telemetry is available on ${result.platform}; waiting for its first measured sample.`
                        : `Measured ${result.platform} host values at ${new Date(result.sampled_at_unix_ms).toLocaleTimeString(locale)}. Missing sensors are shown as unavailable.`
                    : `Host telemetry is unsupported on this platform (${result.platform}); no sample values were invented.`;
            }
            catch (error) {
                if (current()) {
                    hostMetricsSetLocalizedTextContent(status, "Host metrics could not be refreshed.");
                    area.replaceChildren(Amaterasu.errorPanel(error));
                }
            }
        }
        async function refreshActive(current) {
            if (view !== "full" || !settings.show_active_sessions) {
                clearActiveSessions();
                return;
            }
            if (!canReadLive) {
                clearActiveSessions();
                if (current())
                    activeArea.replaceChildren(Amaterasu.panel("Active streaming sessions", Amaterasu.el("p", "muted", "Live stream status is unavailable for this account.")));
                return;
            }
            if (activeArea.firstElementChild === activePanel)
                activeNote.textContent = "Refreshing active stream samples…";
            try {
                const snapshot = Amaterasu.parseLiveStreamSnapshot(await context.api.post("live-streams/status"));
                if (!current())
                    return;
                if (activeEpoch !== snapshot.epoch) {
                    clearActiveSessions();
                    activeEpoch = snapshot.epoch;
                }
                const observed = liveTracker.update(snapshot, settings.history_retention_seconds, settings.max_history_points);
                updateActiveSessions(observed);
            }
            catch (error) {
                if (!current())
                    return;
                clearActiveSessions();
                activeArea.replaceChildren(Amaterasu.panel("Active streaming sessions", Amaterasu.errorPanel(error)));
            }
        }
        function schedule() {
            if (disposed || !container.isConnected || !settingsLoaded || !settings.enabled || timer !== undefined ||
                (view === "overview" && !settings.show_host_stats))
                return;
            if (settings.pause_when_hidden && document.visibilityState !== "visible")
                return;
            timer = window.setTimeout(() => void refresh(), settings.poll_interval_ms);
        }
        function renderDisabledState() {
            clearActiveSessions();
            area.replaceChildren(Amaterasu.empty("Real-time statistics are disabled", "Enable collection in Settings to show live host telemetry."));
            hostMetricsSetLocalizedTextContent(status, "Sampling is disabled.");
        }
        function clearActiveSessions() {
            activeCards.clear();
            liveTracker.clear();
            activeEpoch = null;
            activeList.replaceChildren();
            activeArea.replaceChildren();
        }
        function updateActiveSessions(result) {
            if (activeArea.firstElementChild !== activePanel)
                activeArea.replaceChildren(activePanel);
            const remaining = new Set(result.keys());
            for (const [id, state] of activeCards) {
                if (!remaining.has(id)) {
                    state.card.element.remove();
                    activeCards.delete(id);
                }
            }
            [...result.values()].forEach(({ detail, rounded }, index) => {
                const session = detail.session;
                let state = activeCards.get(session.session_id);
                if (!state) {
                    state = { card: Amaterasu.createLiveSessionCard(context.ui, typeof context.api.allows === "function" && context.api.allows("session.write") ? async (id) => {
                            if (await Amaterasu.confirmAction("Stop this stream?", "The selected stream will stop after its resources are released.", "Stop stream", context.ui)) {
                                await context.api.post("live-streams/stop", { session_id: id });
                                await refresh();
                            }
                        } : undefined), session, liveDetail: detail, recordedDetail: null,
                        snapshot: null, historyNote: "", rounded, lastAttempt: 0 };
                    activeCards.set(session.session_id, state);
                }
                else {
                    if (state.session.started_at_unix !== session.started_at_unix) {
                        state.snapshot = null;
                        state.recordedDetail = null;
                    }
                    state.session = session;
                    state.liveDetail = detail;
                    state.rounded = rounded;
                }
                renderActiveCard(state);
                if (activeList.children[index] !== state.card.element)
                    activeList.insertBefore(state.card.element, activeList.children[index] ?? null);
            });
            activeNote.textContent = result.size ? `${result.size} active ${result.size === 1 ? "stream" : "streams"} reported by the host.` : "No active streams reported.";
            refreshLiveHistory();
        }
        function renderActiveCard(state) {
            const show = (recorded) => state.card.update(state.session, state.liveDetail, recorded, state.historyNote, state.rounded, settings.history_retention_seconds, settings.max_history_points);
            if (!state.recordedDetail) {
                show(null);
                return;
            }
            if (!state.snapshot) {
                show({ ...state.recordedDetail, session: state.session });
                return;
            }
            const newest = state.snapshot.samples.length
                ? Math.max(...state.snapshot.samples.map((sample) => sample.recorded_at_unix)) : 0;
            const samples = state.snapshot.samples.filter((sample) => sample.recorded_at_unix >= newest - settings.history_retention_seconds);
            const count = Math.max(state.recordedDetail.sample_count, samples.length);
            show({ ...state.recordedDetail, session: state.session,
                samples, sample_count: count, samples_truncated: samples.length < count });
        }
        function refreshLiveHistory() {
            if (loadingLiveHistory) {
                liveHistoryPending = true;
                return;
            }
            const now = Date.now();
            const states = [...activeCards.values()].filter((state) => now - state.lastAttempt >= 1000);
            if (!states.length)
                return;
            for (const state of states)
                state.lastAttempt = now;
            loadingLiveHistory = true;
            liveHistoryPending = false;
            const current = (state) => !disposed && container.isConnected && settings.enabled &&
                activeCards.get(state.session.session_id) === state &&
                !(settings.pause_when_hidden && document.visibilityState !== "visible");
            async function refresh() {
                let unavailable = "";
                try {
                    const runtime = Amaterasu.parseHistoryRuntimeStatus(await context.api.post("history/history_status"));
                    if (!runtime.available || !runtime.configuration_ready)
                        unavailable = "Recorded history is unavailable; charts use live observations in this browser.";
                    else if (!runtime.effective_enabled)
                        unavailable = "History recording is disabled; charts use live observations in this browser.";
                }
                catch {
                    unavailable = "Recorded history is unavailable; charts use live observations in this browser.";
                }
                if (unavailable) {
                    for (const state of states)
                        if (current(state)) {
                            state.recordedDetail = null;
                            state.snapshot = null;
                            state.historyNote = unavailable;
                            renderActiveCard(state);
                        }
                    return;
                }
                let next = 0;
                async function worker() {
                    while (next < states.length) {
                        const state = states[next++];
                        if (!current(state))
                            continue;
                        try {
                            const detail = Amaterasu.parseHistoryDetailReply(await context.api.post("history/session_detail", {
                                session_id: state.session.session_id,
                            }), state.session.session_id).detail;
                            if (!current(state))
                                continue;
                            if (detail.session.started_at_unix !== state.session.started_at_unix || detail.session.ended_at_unix !== null)
                                throw new Error("Recorded history does not match the active stream.");
                            state.recordedDetail = detail;
                            if (!state.snapshot) {
                                state.historyNote = "Loading longer history…";
                                renderActiveCard(state);
                            }
                            try {
                                const snapshot = await Amaterasu.loadLiveSampleSnapshot(context.api, state.session.session_id, settings.max_history_points, state.snapshot, () => current(state));
                                if (!current(state) || !snapshot)
                                    continue;
                                if (snapshot.session.started_at_unix !== state.session.started_at_unix || snapshot.session.ended_at_unix !== null)
                                    throw new Error("Recorded history does not match the active stream.");
                                state.snapshot = snapshot;
                                state.historyNote = "";
                            }
                            catch {
                                if (!current(state))
                                    continue;
                                state.snapshot = null;
                                state.historyNote = "Longer history is unavailable; showing recent recorded samples. It will be retried.";
                            }
                        }
                        catch {
                            if (!current(state))
                                continue;
                            state.recordedDetail = null;
                            state.snapshot = null;
                            state.historyNote = "Recorded history is unavailable; charts use live observations in this browser.";
                        }
                        if (current(state))
                            renderActiveCard(state);
                    }
                }
                await Promise.all(Array.from({ length: Math.min(4, states.length) }, () => worker()));
            }
            void refresh().finally(() => {
                loadingLiveHistory = false;
                if (liveHistoryPending && !disposed)
                    refreshLiveHistory();
            });
        }
        async function initialize() {
            const request = ++initializationGeneration;
            hostMetricsSetLocalizedTextContent(status, "Loading live host metrics…");
            if (!canReadSettings) {
                settingsLoaded = true;
                preferenceNotice.textContent = "Display preferences are unavailable for this account; the live view uses defaults.";
                applyVisibility();
                return;
            }
            try {
                const loaded = await loadRealtimeSettings(context.api);
                if (disposed || !container.isConnected || request !== initializationGeneration)
                    return;
                settings = loaded.settings;
                settingsLoaded = true;
                if (sessionHistoryContainer)
                    sessionHistoryContainer.hidden = !settings.show_session_history;
                if (!settings.enabled) {
                    renderDisabledState();
                    return;
                }
                if (view === "overview" && !settings.show_host_stats) {
                    hostMetricsSetLocalizedTextContent(status, "Host statistics are hidden in your settings.");
                    return;
                }
                applyVisibility();
            }
            catch (error) {
                if (!disposed && container.isConnected && request === initializationGeneration) {
                    hostMetricsSetLocalizedTextContent(status, "Host metrics settings are unavailable.");
                    area.replaceChildren(Amaterasu.errorPanel(error, initialize));
                }
            }
        }
        document.addEventListener("visibilitychange", applyVisibility);
        observer = new MutationObserver(() => {
            if (!container.isConnected)
                cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        void initialize();
    }
    Amaterasu.renderHostMetricsDashboard = renderHostMetricsDashboard;
    const gaugeViews = new WeakMap();
    const chartViews = new WeakMap();
    function metricGauge(ui, label, value, detail) {
        let views = gaugeViews.get(ui);
        if (!views) {
            views = new Map();
            gaugeViews.set(ui, views);
        }
        let view = views.get(label);
        if (!view) {
            view = ui.metricGauge({ label, value, detail });
            views.set(label, view);
        }
        else
            view.setValue?.(value, detail);
        return view.element;
    }
    function renderHostStats(result, ui) {
        const host = result.host;
        const percent = (value) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;
        const temperature = (value) => value === null ? "Unavailable" : `${value.toFixed(1)} °C`;
        const bytes = (used, total) => used === null ? "Unavailable" : total === null ? `${formatBytes(used)} / total unavailable` : `${formatBytes(used)} / ${formatBytes(total)}`;
        const rate = (value) => value === null ? "Unavailable" : `${(value / 1_000_000).toFixed(2)} Mbit/s`;
        const memoryPercent = (used, total) => used === null || total === null || total === 0 ? null : used * 100 / total;
        const vital = (label, value, detail) => ui ? metricGauge(ui, label, value, detail) : Amaterasu.el("div", "host-vital", Amaterasu.el("span", "muted", label), Amaterasu.el("strong", value === null ? "host-vital-unavailable" : "", hostMetricsTextLiteral(percent(value))), Amaterasu.el("small", "muted", hostMetricsTextLiteral(detail)));
        const supporting = (label, value) => Amaterasu.el("div", "host-metric-detail", Amaterasu.el("span", "muted", label), Amaterasu.el("strong", "", hostMetricsTextLiteral(value)));
        return Amaterasu.panel("Host vitals", Amaterasu.el("div", "host-vital-grid", vital("CPU", host.cpu_percent, temperature(host.cpu_temp_c)), vital("GPU", host.gpu_percent, temperature(host.gpu_temp_c)), vital("Memory", memoryPercent(host.ram_used_bytes, host.ram_total_bytes), bytes(host.ram_used_bytes, host.ram_total_bytes)), vital("Video memory", memoryPercent(host.vram_used_bytes, host.vram_total_bytes), bytes(host.vram_used_bytes, host.vram_total_bytes))), Amaterasu.el("div", "host-metric-details", supporting("Encoder utilization", percent(host.gpu_encoder_percent)), supporting("Network receive", rate(host.net_rx_bps)), supporting("Network transmit", rate(host.net_tx_bps))));
    }
    function renderHostCharts(samples, ui) {
        if (samples.length === 0)
            return Amaterasu.panel("Recent host charts", Amaterasu.empty("No samples yet", "Measured history appears as the host collects samples."));
        const charts = [
            { label: "CPU utilization", values: samples.map((sample) => sample.host.cpu_percent), maximum: 100 },
            { label: "GPU utilization", values: samples.map((sample) => sample.host.gpu_percent), maximum: 100 },
            { label: "Memory use", values: samples.map((sample) => {
                    const used = sample.host.ram_used_bytes;
                    const total = sample.host.ram_total_bytes;
                    return used === null || total === null || total === 0 ? null : used * 100 / total;
                }), maximum: 100 },
            { label: "Video memory use", values: samples.map((sample) => {
                    const used = sample.host.vram_used_bytes;
                    const total = sample.host.vram_total_bytes;
                    return used === null || total === null || total === 0 ? null : used * 100 / total;
                }), maximum: 100 },
            { label: "Network receive", values: samples.map((sample) => sample.host.net_rx_bps === null ? null : sample.host.net_rx_bps / 1_000_000), maximum: Math.max(10, ...samples.map((sample) => (sample.host.net_rx_bps ?? 0) / 1_000_000)) },
            { label: "Network transmit", values: samples.map((sample) => sample.host.net_tx_bps === null ? null : sample.host.net_tx_bps / 1_000_000), maximum: Math.max(10, ...samples.map((sample) => (sample.host.net_tx_bps ?? 0) / 1_000_000)) },
        ];
        const graphics = charts.map((chart) => {
            if (ui) {
                let views = chartViews.get(ui);
                if (!views) {
                    views = new Map();
                    chartViews.set(ui, views);
                }
                const series = [{ id: chart.label, label: chart.label, points: chart.values.map((value, index) => ({ time: samples[index].recorded_at_unix_ms, value })) }];
                let view = views.get(chart.label);
                if (!view) {
                    view = ui.metricChart({ label: chart.label, unit: chart.label.startsWith("Network") ? "Mbit/s" : "%", minimum: 0, ...(chart.maximum === 100 ? { maximum: 100 } : {}), series });
                    views.set(chart.label, view);
                }
                else
                    view.setData?.(series);
                return view.element;
            }
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 320 84");
            svg.setAttribute("width", "320");
            svg.setAttribute("height", "84");
            svg.setAttribute("role", "img");
            if (typeof Amaterasu.setLocalizedAttributeTemplate === "function") {
                Amaterasu.setLocalizedAttributeTemplate(svg, "aria-label", "{label} over recent measured samples", { label: hostMetricsTextMessage(chart.label) });
            }
            else {
                svg.setAttribute("aria-label", `${chart.label} over recent measured samples`);
            }
            svg.classList.add("host-metric-chart");
            const axis = document.createElementNS(svg.namespaceURI, "path");
            axis.setAttribute("d", "M 0 78 H 320");
            axis.setAttribute("class", "host-metric-chart-axis");
            axis.setAttribute("stroke", "currentColor");
            axis.setAttribute("stroke-opacity", "0.3");
            svg.append(axis);
            const segments = [];
            let segment = [];
            chart.values.forEach((value, index) => {
                if (value === null) {
                    if (segment.length)
                        segments.push(segment);
                    segment = [];
                    return;
                }
                segment.push({
                    x: (index / Math.max(chart.values.length - 1, 1)) * 320,
                    y: 78 - Math.min(value / chart.maximum, 1) * 72,
                });
            });
            if (segment.length)
                segments.push(segment);
            for (const points of segments) {
                if (points.length === 1) {
                    const point = points[0];
                    if (!point)
                        continue;
                    const marker = document.createElementNS(svg.namespaceURI, "circle");
                    marker.setAttribute("cx", String(point.x));
                    marker.setAttribute("cy", String(point.y));
                    marker.setAttribute("r", "3");
                    marker.setAttribute("class", "host-metric-chart-line");
                    svg.append(marker);
                }
                else {
                    const line = document.createElementNS(svg.namespaceURI, "polyline");
                    line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
                    line.setAttribute("class", "host-metric-chart-line");
                    line.setAttribute("fill", "none");
                    line.setAttribute("stroke", "currentColor");
                    line.setAttribute("stroke-width", "2");
                    svg.append(line);
                }
            }
            const unit = chart.label.startsWith("Network") ? "Mbit/s" : "%";
            const lastValue = chart.values.at(-1);
            const latest = lastValue == null ? "Unavailable" : `${lastValue.toFixed(1)} ${unit}`;
            return Amaterasu.el("div", "host-metric-chart-card", Amaterasu.el("div", "host-metric-chart-heading", Amaterasu.el("strong", "", chart.label), Amaterasu.el("span", "", hostMetricsTextLiteral(latest))), svg, Amaterasu.el("small", "muted", hostMetricsTextLiteral(`${chart.values.filter((value) => value !== null).length} measured points · scale 0–${chart.maximum.toFixed(1)} ${unit}`)));
        });
        const grid = Amaterasu.el("div", "host-metric-chart-grid", ...graphics);
        return Amaterasu.panel("Recent host charts", grid);
    }
    function formatBytes(value) {
        if (!Number.isFinite(value) || value < 0)
            return "Unavailable";
        const units = ["B", "KiB", "MiB", "GiB", "TiB"];
        let amount = value;
        let index = 0;
        while (amount >= 1024 && index < units.length - 1) {
            amount /= 1024;
            index += 1;
        }
        return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
    }
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    function pagesTextLiteral(value) {
        return typeof Amaterasu.literalText === "function" ? Amaterasu.literalText(value) : value;
    }
    function pagesTextMessage(value) {
        return typeof Amaterasu.localizedMessage === "function" ? Amaterasu.localizedMessage(value) : value;
    }
    function pagesSetLocalizedTextContent(target, source) {
        if (typeof Amaterasu.setLocalizedTextContent === "function") {
            Amaterasu.setLocalizedTextContent(target, source);
        }
        else {
            target.textContent = source;
        }
    }
    function localizedDateTime(unixSeconds) {
        const date = new Date(unixSeconds * 1000);
        return typeof Amaterasu.localeFormattedTextNode === "function"
            ? Amaterasu.localeFormattedTextNode((locale) => date.toLocaleString(locale))
            : date.toLocaleString();
    }
    function parseHistoryRuntimeStatus(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("History status reply is invalid.");
        const reply = value;
        if (reply.ok !== true || !reply.status || typeof reply.status !== "object" || Array.isArray(reply.status))
            throw new Error("History status reply is invalid.");
        const status = reply.status;
        if (status.applied_revision !== null &&
            (!Number.isSafeInteger(status.applied_revision) || status.applied_revision < 0))
            throw new Error("History applied revision is invalid.");
        const prune = status.last_prune;
        if (!prune || typeof prune !== "object" || Array.isArray(prune))
            throw new Error("History retention status is invalid.");
        const retention = prune;
        for (const key of ["available", "configuration_ready", "enabled", "effective_enabled", "degraded"])
            if (typeof status[key] !== "boolean")
                throw new Error(`History ${key} status is invalid.`);
        for (const key of ["failed_operations", "active_streams", "sessions", "samples", "events", "live_bytes"])
            if (!Number.isSafeInteger(status[key]) || status[key] < 0)
                throw new Error(`History ${key} count is invalid.`);
        if (status.pending_activities !== undefined &&
            (!Number.isSafeInteger(status.pending_activities) || status.pending_activities < 0))
            throw new Error("History pending activities count is invalid.");
        for (const key of ["sessions_deleted", "live_bytes", "size_limit_bytes"])
            if (!Number.isSafeInteger(retention[key]) || retention[key] < 0)
                throw new Error(`History retention ${key} count is invalid.`);
        if (typeof retention.size_limit_unmet !== "boolean")
            throw new Error("History retention limit status is invalid.");
        return { ...status, pending_activities: status.pending_activities ?? 0 };
    }
    Amaterasu.parseHistoryRuntimeStatus = parseHistoryRuntimeStatus;
    function historyRecordingPolicyDescription(status) {
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
    Amaterasu.historyRecordingPolicyDescription = historyRecordingPolicyDescription;
    function historyActivityDescription(status) {
        const active = `${status.active_streams} active ${status.active_streams === 1 ? "stream" : "streams"}`;
        const pending = `${status.pending_activities} pending ${status.pending_activities === 1 ? "launch" : "launches"}`;
        return `${active} · ${pending}`;
    }
    Amaterasu.historyActivityDescription = historyActivityDescription;
    function historyRuntimeDescription(status) {
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
    Amaterasu.historyRuntimeDescription = historyRuntimeDescription;
    function parseHistoryDetailReply(value, sessionId) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("History detail reply is invalid.");
        const reply = value;
        if (reply.ok !== true || !reply.detail || typeof reply.detail !== "object" || Array.isArray(reply.detail))
            throw new Error("History detail reply is invalid.");
        const detail = reply.detail;
        const session = detail.session;
        if (!session || typeof session !== "object" || Array.isArray(session) ||
            session.session_id !== sessionId)
            throw new Error("History detail belongs to a different session.");
        parseHistoryListReply({ ok: true, sessions: [session], next_offset: null }, 0);
        const summary = session;
        if (["device_name", "codec"].some((key) => typeof summary[key] !== "string") ||
            ["width", "height", "target_fps", "target_bitrate_kbps"].some((key) => !Number.isSafeInteger(summary[key]) || summary[key] < 0 || summary[key] > 0xffff_ffff))
            throw new Error("History session metadata is invalid.");
        for (const key of ["sample_count", "event_count"])
            if (!Number.isSafeInteger(detail[key]) || detail[key] < 0)
                throw new Error(`History ${key} is invalid.`);
        for (const key of ["samples_truncated", "events_truncated"])
            if (typeof detail[key] !== "boolean")
                throw new Error(`History ${key} is invalid.`);
        for (const [key, countKey] of [["samples", "sample_count"], ["events", "event_count"]]) {
            const rows = detail[key];
            const truncated = detail[key === "samples" ? "samples_truncated" : "events_truncated"];
            if (!Array.isArray(rows) || rows.length > (key === "samples" ? 32 : 8) ||
                rows.length > detail[countKey] || truncated !== (rows.length < detail[countKey]) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) || row.session_id !== sessionId ||
                !Number.isSafeInteger(row.recorded_at_unix)))
                throw new Error(`History ${key} are invalid.`);
        }
        for (const sample of detail.samples) {
            for (const key of ["frames_sent", "bytes_sent", "dropped_frames"])
                if (!Number.isSafeInteger(sample[key]) || sample[key] < 0)
                    throw new Error(`History sample ${key} is invalid.`);
            for (const key of ["actual_fps", "actual_bitrate_kbps"])
                if (typeof sample[key] !== "number" || !Number.isFinite(sample[key]) || sample[key] < 0)
                    throw new Error(`History sample ${key} is invalid.`);
            if (sample.encode_latency_ms != null && (typeof sample.encode_latency_ms !== "number" ||
                !Number.isFinite(sample.encode_latency_ms) || sample.encode_latency_ms < 0))
                throw new Error("History sample encode_latency_ms is invalid.");
        }
        if (detail.events.some((event) => typeof event.event_type !== "string"))
            throw new Error("History event type is invalid.");
        return reply;
    }
    Amaterasu.parseHistoryDetailReply = parseHistoryDetailReply;
    function parseHistoryListReply(value, offset) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("History session page is invalid.");
        const reply = value;
        if (reply.ok !== true || !Array.isArray(reply.sessions) || reply.sessions.length > 25 ||
            (reply.next_offset !== null && (!Number.isSafeInteger(reply.next_offset) ||
                reply.next_offset <= offset)))
            throw new Error("History session page is invalid.");
        const ids = new Set();
        for (const entry of reply.sessions) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
                throw new Error("History session row is invalid.");
            const session = entry;
            if (typeof session.session_id !== "string" || session.session_id.length === 0 ||
                new TextEncoder().encode(session.session_id).length > 128 ||
                /[\u0000-\u001f\u007f-\u009f]/u.test(session.session_id) ||
                ["app_name", "client_name", "device_name", "protocol", "codec"].some((key) => typeof session[key] !== "string") ||
                ["width", "height", "target_fps", "target_bitrate_kbps"].some((key) => !Number.isSafeInteger(session[key]) || session[key] < 0 || session[key] > 0xffff_ffff) ||
                !Number.isSafeInteger(session.started_at_unix) ||
                (session.ended_at_unix !== null && !Number.isSafeInteger(session.ended_at_unix)) ||
                (session.duration_seconds !== null &&
                    (!Number.isSafeInteger(session.duration_seconds) || session.duration_seconds < 0)))
                throw new Error("History session row is invalid.");
            if (ids.has(session.session_id))
                throw new Error("History session page contains a duplicate stream.");
            ids.add(session.session_id);
        }
        return reply;
    }
    Amaterasu.parseHistoryListReply = parseHistoryListReply;
    function parseHistoryDeleteReply(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) ||
            value.ok !== true)
            throw new Error("History deletion was not confirmed. Refresh the recorded sessions before trying again.");
    }
    Amaterasu.parseHistoryDeleteReply = parseHistoryDeleteReply;
    async function confirmHistoryDeletion(api, sessionId) {
        try {
            await api.post("history/session_detail", { session_id: sessionId });
        }
        catch (error) {
            if (error && typeof error === "object" &&
                error.code === "not_found")
                return;
            throw error;
        }
        throw new Error("History deletion could not be confirmed by readback. Refresh the recorded sessions.");
    }
    Amaterasu.confirmHistoryDeletion = confirmHistoryDeletion;
    function renderSessions(context) {
        const metricsArea = Amaterasu.el("div");
        const historyRuntimeArea = Amaterasu.el("div");
        const savedArea = Amaterasu.el("div");
        const savedDetail = Amaterasu.el("div");
        const savedStatus = Amaterasu.el("div");
        let savedOffset = 0;
        const savedHistory = [0];
        let savedListRequest = 0;
        let savedDetailRequest = 0;
        let timelineRequest = 0;
        let historyStatusRequest = 0;
        let historyDeleteAvailable = false;
        let historyDeleteReason = "Checking history status before deletion is available.";
        let deleteControls = [];
        const deleteNotice = Amaterasu.el("p", "muted", historyDeleteReason);
        let selectedSavedSessions = new Set();
        const savedHistoryPanel = Amaterasu.panel("Recorded stream sessions", savedArea, savedStatus, savedDetail);
        context.content.append(Amaterasu.sectionHeading("Statistics", "Live host measurements and recorded streaming performance.", Amaterasu.button("Refresh", () => {
            void loadHistoryRuntime();
            void loadSaved();
        })), metricsArea, Amaterasu.panel("History runtime status", historyRuntimeArea), savedHistoryPanel);
        function applyHistoryDeleteAvailability() {
            pagesSetLocalizedTextContent(deleteNotice, historyDeleteReason);
            for (const control of deleteControls)
                control.button.disabled = !control.ended || !context.api.allows("session.write") || !historyDeleteAvailable;
        }
        async function loadHistoryRuntime() {
            const request = ++historyStatusRequest;
            historyDeleteAvailable = false;
            historyDeleteReason = "Checking history status before deletion is available.";
            applyHistoryDeleteAvailability();
            historyRuntimeArea.replaceChildren(Amaterasu.el("p", "muted", "Loading history runtime status…"));
            try {
                const runtime = parseHistoryRuntimeStatus(await context.api.post("history/history_status"));
                if (!context.content.isConnected || request !== historyStatusRequest)
                    return false;
                historyDeleteAvailable = runtime.available && runtime.configuration_ready && runtime.effective_enabled;
                historyDeleteReason = historyDeleteAvailable
                    ? ""
                    : runtime.available && runtime.configuration_ready && !runtime.effective_enabled
                        ? "Deletion is unavailable while history recording is disabled. Stored sessions remain readable."
                        : "Deletion is unavailable until history storage and configuration are ready.";
                applyHistoryDeleteAvailability();
                historyRuntimeArea.replaceChildren(...historyRuntimeDescription(runtime).map((line) => Amaterasu.el("p", "muted", line)), Amaterasu.button("Refresh history status", () => { void loadHistoryRuntime(); }));
                return historyDeleteAvailable;
            }
            catch (error) {
                if (context.content.isConnected && request === historyStatusRequest) {
                    historyDeleteReason = "Deletion is unavailable until history runtime status can be confirmed. Stored sessions remain readable.";
                    applyHistoryDeleteAvailability();
                    historyRuntimeArea.replaceChildren(Amaterasu.errorPanel(error, () => { void loadHistoryRuntime(); }));
                }
                return false;
            }
        }
        async function loadSaved() {
            const request = ++savedListRequest;
            savedArea.replaceChildren(Amaterasu.el("p", "muted", "Loading recorded sessions…"));
            try {
                const reply = parseHistoryListReply(await context.api.post("history/list_sessions", { limit: 25, offset: savedOffset }), savedOffset);
                if (!context.content.isConnected || request !== savedListRequest)
                    return;
                const currentDeleteControls = [];
                function deleteButton(session) {
                    const remove = Amaterasu.button("Delete", async () => {
                        if (!context.api.allows("session.write") || !historyDeleteAvailable || !(await loadHistoryRuntime()))
                            return;
                        if (!(await Amaterasu.confirmAction("Delete this recorded session?", pagesTextLiteral(`The history for ${session.app_name || session.session_id} will be removed.`), "Delete history", context.ui)))
                            return;
                        if (!context.api.allows("session.write") || !historyDeleteAvailable || !(await loadHistoryRuntime()))
                            return;
                        await Amaterasu.runAction(remove, savedStatus, async () => {
                            parseHistoryDeleteReply(await context.api.post("history/delete_session", {
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
                    }, "quiet danger-text");
                    currentDeleteControls.push({ button: remove, ended: session.ended_at_unix != null });
                    return remove;
                }
                const groups = Amaterasu.groupRecordedSessions(reply.sessions);
                const cards = groups.map((members) => {
                    const session = members[0];
                    const details = Amaterasu.button("Details", () => members.length > 1
                        ? loadSavedGroup(members) : loadSavedDetail(session.session_id));
                    const memberControls = members.length === 1 ? deleteButton(session) : Amaterasu.el("details", "history-card-members", Amaterasu.el("summary", "", pagesTextLiteral(`Manage ${members.length} individual streams`)), ...members.map((member) => Amaterasu.el("div", "history-card-member", Amaterasu.el("div", "", Amaterasu.el("strong", "", pagesTextLiteral(member.session_id)), Amaterasu.el("small", "muted block", localizedDateTime(member.started_at_unix))), Amaterasu.el("div", "actions", Amaterasu.button("Details", () => loadSavedDetail(member.session_id)), deleteButton(member)))));
                    const resolution = session.width && session.height ? `${session.width} × ${session.height}` : "Resolution unavailable";
                    return Amaterasu.el("article", "history-card", Amaterasu.el("div", "history-card-topline", members.length > 1
                        ? Amaterasu.badge(pagesTextLiteral(`${members.length} nearby streams`)) : Amaterasu.badge(pagesTextLiteral(session.protocol || "Unknown")), Amaterasu.el("time", "muted", localizedDateTime(session.started_at_unix))), Amaterasu.el("strong", "history-card-title", pagesTextLiteral(session.app_name || (members.length > 1 ? "Unnamed application" : session.session_id))), Amaterasu.el("span", "muted", pagesTextLiteral(session.client_name || session.device_name || "Client unavailable")), Amaterasu.el("span", "muted", pagesTextLiteral(`${resolution}${session.target_fps ? ` · ${session.target_fps} fps` : ""} · ${session.codec || "Codec unavailable"}`)), Amaterasu.el("div", "actions", details, ...(members.length === 1 ? [memberControls] : [])), ...(members.length > 1 ? [memberControls] : []));
                });
                deleteControls = currentDeleteControls;
                applyHistoryDeleteAvailability();
                savedArea.replaceChildren(deleteNotice, ...(groups.some((members) => members.length > 1) ? [Amaterasu.el("p", "muted", "Nearby streams with matching names are grouped on this page; a reconnect is not confirmed.")] : []), reply.sessions.length
                    ? Amaterasu.el("div", "history-card-grid", ...cards)
                    : Amaterasu.empty("No recorded streams", "Completed streams appear here when history recording is enabled."), Amaterasu.pager(savedHistory.length > 1
                    ? () => {
                        savedHistory.pop();
                        savedOffset = savedHistory[savedHistory.length - 1] ?? 0;
                        void loadSaved();
                    }
                    : null, reply.next_offset != null
                    ? () => {
                        savedOffset = reply.next_offset;
                        savedHistory.push(savedOffset);
                        void loadSaved();
                    }
                    : null, pagesTextLiteral(`Showing from ${savedOffset + 1}`)));
            }
            catch (error) {
                if (context.content.isConnected && request === savedListRequest)
                    savedArea.replaceChildren(Amaterasu.errorPanel(error, loadSaved));
            }
        }
        async function loadSavedDetail(sessionId) {
            selectedSavedSessions = new Set([sessionId]);
            const request = ++savedDetailRequest;
            ++timelineRequest;
            savedDetail.replaceChildren(Amaterasu.el("p", "muted", "Loading session details…"));
            try {
                const reply = parseHistoryDetailReply(await context.api.post("history/session_detail", { session_id: sessionId }), sessionId);
                if (!context.content.isConnected || request !== savedDetailRequest)
                    return;
                const detail = reply.detail;
                if (!detail)
                    return;
                const close = () => {
                    ++savedDetailRequest;
                    ++timelineRequest;
                    selectedSavedSessions.clear();
                    savedDetail.replaceChildren();
                };
                const complete = !detail.samples_truncated && !detail.events_truncated;
                let view = Amaterasu.renderRecordedSessionDetail(detail, close, complete, undefined, context.ui);
                const timelineStatus = Amaterasu.el("div", "recorded-timeline-status");
                savedDetail.replaceChildren(timelineStatus, view);
                if (!complete) {
                    let engaged = false;
                    const markEngaged = () => { engaged = true; };
                    for (const event of ["pointerdown", "keydown", "input", "change"])
                        view.addEventListener(event, markEngaged);
                    function installComplete(full) {
                        view = Amaterasu.renderRecordedSessionDetail(full, close, true, undefined, context.ui);
                        timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "All retained history in the captured snapshot is loaded."));
                        savedDetail.replaceChildren(timelineStatus, view);
                    }
                    async function loadTimeline() {
                        const timeline = ++timelineRequest;
                        const active = () => context.content.isConnected && request === savedDetailRequest && timeline === timelineRequest;
                        const progress = Amaterasu.el("p", "muted", "Loading retained history…");
                        progress.setAttribute("role", "status");
                        const cancel = Amaterasu.button("Cancel history loading", () => {
                            if (!active())
                                return;
                            ++timelineRequest;
                            timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "Full history loading was cancelled; the recent snapshot remains available."), Amaterasu.button("Retry full history", () => void loadTimeline()));
                        });
                        timelineStatus.replaceChildren(progress, cancel);
                        try {
                            const full = await Amaterasu.loadRetainedTimeline(context.api, sessionId, active, (samples, sampleTotal, events, eventTotal) => {
                                if (active())
                                    progress.textContent = `Loading retained history… ${samples} of ${sampleTotal} samples · ${events} of ${eventTotal} events`;
                            });
                            if (!active() || !full)
                                return;
                            const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
                            const viewingSelection = !!selection && !selection.isCollapsed && !!selection.anchorNode && view.contains(selection.anchorNode);
                            if (engaged || viewingSelection || (document.activeElement && view.contains(document.activeElement))) {
                                timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "Full retained history is ready."), Amaterasu.button("Show full retained history", () => { if (active())
                                    installComplete(full); }));
                            }
                            else
                                installComplete(full);
                        }
                        catch (error) {
                            if (active())
                                timelineStatus.replaceChildren(Amaterasu.errorPanel(error, () => void loadTimeline()), Amaterasu.el("p", "muted", "The recent snapshot remains available; no partial full-history result was applied."));
                        }
                    }
                    void loadTimeline();
                }
            }
            catch (error) {
                if (context.content.isConnected && request === savedDetailRequest)
                    savedDetail.replaceChildren(Amaterasu.errorPanel(error, () => loadSavedDetail(sessionId)));
            }
        }
        async function loadSavedGroup(members) {
            selectedSavedSessions = new Set(members.map((member) => member.session_id));
            const request = ++savedDetailRequest;
            ++timelineRequest;
            savedDetail.replaceChildren(Amaterasu.el("p", "muted", "Loading nearby stream details…"));
            let halted = false;
            const current = () => !halted && context.content.isConnected && request === savedDetailRequest;
            try {
                const details = new Array(members.length);
                let next = 0;
                async function readDetails() {
                    while (current() && next < members.length) {
                        const index = next++;
                        const id = members[index].session_id;
                        details[index] = parseHistoryDetailReply(await context.api.post("history/session_detail", { session_id: id }), id).detail;
                    }
                }
                try {
                    await Promise.all(Array.from({ length: Math.min(3, members.length) }, () => readDetails()));
                }
                catch (error) {
                    halted = true;
                    throw error;
                }
                if (!current())
                    return;
                if (Amaterasu.groupRecordedSessions(details.map((detail) => detail.session)).length !== 1)
                    throw new Error("These streams no longer match this group. Refresh the session list.");
                const close = () => {
                    ++savedDetailRequest;
                    ++timelineRequest;
                    selectedSavedSessions.clear();
                    savedDetail.replaceChildren();
                };
                const complete = details.every((detail) => !detail.samples_truncated && !detail.events_truncated);
                let view = Amaterasu.renderRecordedSessionDetail(Amaterasu.mergeRecordedSessionDetails(details), close, complete, details, context.ui);
                const timelineStatus = Amaterasu.el("div", "recorded-timeline-status");
                savedDetail.replaceChildren(timelineStatus, view);
                if (complete)
                    return;
                let engaged = false;
                const markEngaged = () => { engaged = true; };
                for (const event of ["pointerdown", "keydown", "input", "change"])
                    view.addEventListener(event, markEngaged);
                function withinLimit(samples, events) {
                    return samples.reduce((sum, value) => sum + value, 0) <= 25_000 &&
                        events.reduce((sum, value) => sum + value, 0) <= 5_000;
                }
                function installComplete(full) {
                    view = Amaterasu.renderRecordedSessionDetail(Amaterasu.mergeRecordedSessionDetails(full), close, true, full, context.ui);
                    timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "All retained history in each captured stream snapshot is loaded."));
                    savedDetail.replaceChildren(timelineStatus, view);
                }
                async function loadTimelines() {
                    const timeline = ++timelineRequest;
                    let stopped = false;
                    const active = () => current() && !stopped && timeline === timelineRequest;
                    const sampleTotals = details.map((detail) => detail.sample_count);
                    const eventTotals = details.map((detail) => detail.event_count);
                    if (!withinLimit(sampleTotals, eventTotals)) {
                        timelineStatus.replaceChildren(Amaterasu.el("p", "notice", "This group exceeds the browser limit for a complete history. Recent snapshots remain available; open an individual stream for its full history."));
                        return;
                    }
                    const progress = Amaterasu.el("p", "muted", "Loading retained history for nearby streams…");
                    progress.setAttribute("role", "status");
                    const cancel = Amaterasu.button("Cancel history loading", () => {
                        if (!active())
                            return;
                        ++timelineRequest;
                        timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "Full history loading was cancelled; recent snapshots remain available."), Amaterasu.button("Retry full history", () => void loadTimelines()));
                    });
                    timelineStatus.replaceChildren(progress, cancel);
                    const full = [...details];
                    let index = 0;
                    let done = 0;
                    async function readTimeline() {
                        while (active() && index < full.length) {
                            const position = index++;
                            const detail = full[position];
                            if (detail.samples_truncated || detail.events_truncated) {
                                const loaded = await Amaterasu.loadRetainedTimeline(context.api, detail.session.session_id, active, (_samples, sampleTotal, _events, eventTotal) => {
                                    sampleTotals[position] = sampleTotal;
                                    eventTotals[position] = eventTotal;
                                    if (!withinLimit(sampleTotals, eventTotals))
                                        throw new Error("This group exceeds the browser limit for a complete history. Open an individual stream instead.");
                                });
                                if (!active() || !loaded)
                                    return;
                                full[position] = loaded;
                            }
                            done++;
                            if (active())
                                progress.textContent = `Loading retained history… ${done} of ${full.length} streams`;
                        }
                    }
                    try {
                        try {
                            await Promise.all(Array.from({ length: Math.min(3, full.length) }, () => readTimeline()));
                        }
                        catch (error) {
                            stopped = true;
                            throw error;
                        }
                        if (!active())
                            return;
                        if (Amaterasu.groupRecordedSessions(full.map((detail) => detail.session)).length !== 1)
                            throw new Error("These streams no longer match this group. Refresh the session list.");
                        const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
                        const viewingSelection = !!selection && !selection.isCollapsed && !!selection.anchorNode && view.contains(selection.anchorNode);
                        if (engaged || viewingSelection || (document.activeElement && view.contains(document.activeElement))) {
                            timelineStatus.replaceChildren(Amaterasu.el("p", "muted", "Full retained history is ready for all streams."), Amaterasu.button("Show full retained history", () => { if (active())
                                installComplete(full); }));
                        }
                        else
                            installComplete(full);
                    }
                    catch (error) {
                        if (current() && timeline === timelineRequest)
                            timelineStatus.replaceChildren(Amaterasu.errorPanel(error, () => void loadTimelines()), Amaterasu.el("p", "muted", "Recent snapshots remain available; no partial full-history result was applied."));
                    }
                }
                void loadTimelines();
            }
            catch (error) {
                if (context.content.isConnected && request === savedDetailRequest)
                    savedDetail.replaceChildren(Amaterasu.errorPanel(error, () => loadSavedGroup(members)));
            }
        }
        void loadHistoryRuntime();
        void loadSaved();
        if (context.api.allows("diagnostics.read") || context.api.allows("session.read"))
            Amaterasu.renderHostMetricsDashboard(context, metricsArea, savedHistoryPanel);
        else
            metricsArea.replaceChildren(Amaterasu.panel("Live host metrics", Amaterasu.el("p", "muted", "Host metrics are unavailable for this account.")));
    }
    Amaterasu.renderSessions = renderSessions;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    const maxHistoryLimit = 0x7fffffff;
    const settingsTextLiteral = Amaterasu.literalText;
    function parseHistorySettings(enabled, ttlDays, sizeLimitMb) {
        if (typeof enabled !== "boolean" ||
            typeof ttlDays !== "number" ||
            !Number.isSafeInteger(ttlDays) ||
            ttlDays < 0 ||
            ttlDays > maxHistoryLimit ||
            typeof sizeLimitMb !== "number" ||
            !Number.isSafeInteger(sizeLimitMb) ||
            sizeLimitMb < 0 ||
            sizeLimitMb > maxHistoryLimit)
            throw new Error("History limits must be whole numbers from 0 to 2147483647.");
        return { enabled, ttl_days: ttlDays, db_size_limit_mb: sizeLimitMb };
    }
    Amaterasu.parseHistorySettings = parseHistorySettings;
    function parseHistorySettingsReply(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            throw new Error("Session history settings reply is invalid.");
        const reply = value;
        if (reply.ok !== true)
            throw new Error("Session history settings reply must report success.");
        if (reply.settings === null || typeof reply.settings !== "object" || Array.isArray(reply.settings))
            throw new Error("Session history settings reply contains invalid settings.");
        if (typeof reply.revision !== "number" ||
            !Number.isSafeInteger(reply.revision) ||
            reply.revision < 0)
            throw new Error("Session history settings revision must be a nonnegative safe integer.");
        if (typeof reply.effective_enabled !== "boolean")
            throw new Error("Session history effective enabled state must be a boolean.");
        const settings = reply.settings;
        return {
            ok: true,
            settings: parseHistorySettings(settings.enabled, settings.ttl_days, settings.db_size_limit_mb),
            revision: reply.revision,
            effective_enabled: reply.effective_enabled,
        };
    }
    Amaterasu.parseHistorySettingsReply = parseHistorySettingsReply;
    async function saveHistorySettings(api, current, enabled, ttlDays, sizeLimitMb) {
        const settings = parseHistorySettings(enabled, ttlDays, sizeLimitMb);
        const updateReply = await api.post("history/settings_update", {
            settings,
            expected_revision: current.revision,
        });
        if (updateReply && typeof updateReply === "object" &&
            updateReply.code === "revision_conflict")
            throw new Error("Session history settings changed in another editor. Refresh and try again.");
        const updated = parseHistorySettingsReply(updateReply);
        if (updated.revision !== current.revision + 1 ||
            updated.settings.enabled !== settings.enabled ||
            updated.settings.ttl_days !== settings.ttl_days ||
            updated.settings.db_size_limit_mb !== settings.db_size_limit_mb)
            throw new Error("Session history update did not confirm the requested settings. Refresh and check the current values.");
        const saved = parseHistorySettingsReply(await api.post("history/settings_get"));
        if (saved.revision !== current.revision + 1 ||
            saved.settings.enabled !== settings.enabled ||
            saved.settings.ttl_days !== settings.ttl_days ||
            saved.settings.db_size_limit_mb !== settings.db_size_limit_mb)
            throw new Error("Session history settings could not be confirmed after saving. Refresh and check the current values.");
        return saved;
    }
    Amaterasu.saveHistorySettings = saveHistorySettings;
    async function readHistorySettingsState(api) {
        const settings = parseHistorySettingsReply(await api.post("history/settings_get"));
        return { settings, runtime: await readHistoryRuntime(api) };
    }
    Amaterasu.readHistorySettingsState = readHistorySettingsState;
    class HistorySettingsLoadGate {
        generation = 0;
        invalidate() {
            this.generation += 1;
        }
        async read(api) {
            const generation = ++this.generation;
            try {
                const state = await readHistorySettingsState(api);
                return generation === this.generation ? state : null;
            }
            catch (error) {
                if (generation !== this.generation)
                    return null;
                throw error;
            }
        }
    }
    Amaterasu.HistorySettingsLoadGate = HistorySettingsLoadGate;
    async function readHistoryRuntime(api) {
        try {
            return Amaterasu.parseHistoryRuntimeStatus(await api.post("history/history_status"));
        }
        catch {
            return null;
        }
    }
    async function saveHistorySettingsState(api, current, enabled, ttlDays, sizeLimitMb) {
        const settings = await saveHistorySettings(api, current, enabled, ttlDays, sizeLimitMb);
        return { settings, runtime: await readHistoryRuntime(api) };
    }
    Amaterasu.saveHistorySettingsState = saveHistorySettingsState;
    function historySettingsRuntimeDescription(settings, runtime) {
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
    Amaterasu.historySettingsRuntimeDescription = historySettingsRuntimeDescription;
    function renderHistorySettings(context, historyArea) {
        const historyLoads = new HistorySettingsLoadGate();
        async function loadHistorySettings() {
            historyArea.replaceChildren(Amaterasu.el("p", "muted", "Loading session history settings…"));
            try {
                const state = await historyLoads.read(context.api);
                if (state === null)
                    return;
                const { settings: reply, runtime } = state;
                if (!context.content.isConnected)
                    return;
                const form = Amaterasu.el("form", "settings-form");
                const enabled = Amaterasu.input("session_history_enabled", "", "checkbox");
                enabled.checked = reply.settings.enabled;
                const ttl = Amaterasu.input("session_history_ttl_days", String(reply.settings.ttl_days), "number");
                const size = Amaterasu.input("session_history_db_size_limit_mb", String(reply.settings.db_size_limit_mb), "number");
                for (const control of [ttl, size]) {
                    control.required = true;
                    control.min = "0";
                    control.max = String(maxHistoryLimit);
                    control.step = "1";
                }
                const ttlField = Amaterasu.field("Keep ended sessions for (days)", ttl, "Zero disables age pruning.");
                const sizeField = Amaterasu.field("Approximate live database limit (MiB)", size, "Zero disables size pruning. Active sessions are never deleted to meet this limit.");
                const status = Amaterasu.el("p", "muted", historySettingsRuntimeDescription(reply, runtime));
                const save = Amaterasu.el("button", "button primary", "Save history settings");
                save.type = "submit";
                save.disabled = !context.api.allows("configuration.write");
                form.append(Amaterasu.field("Record session history", enabled, "Recording changes wait for active streams to end and pending launches to resolve. Check the runtime status for the effective policy."), Amaterasu.el("p", "muted", "Retention limits are saved while recording is disabled. Stored sessions remain readable, but automatic pruning and deletion resume only after recording is enabled."), ttlField, sizeField, status, Amaterasu.el("div", "actions", save, Amaterasu.badge(settingsTextLiteral(`Revision ${reply.revision}`))));
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    context.setBusy?.(save, true);
                    void Amaterasu.runAction(save, status, async () => {
                        historyLoads.invalidate();
                        const updated = await saveHistorySettingsState(context.api, reply, enabled.checked, ttl.valueAsNumber, size.valueAsNumber);
                        context.notify(historySettingsRuntimeDescription(updated.settings, updated.runtime));
                        await loadHistorySettings();
                    }).finally(() => context.setBusy?.(save, false));
                });
                historyArea.replaceChildren(Amaterasu.panel("Session history", form));
            }
            catch (error) {
                if (context.content.isConnected)
                    historyArea.replaceChildren(Amaterasu.errorPanel(error, loadHistorySettings));
            }
        }
        void loadHistorySettings();
    }
    Amaterasu.renderHistorySettings = renderHistorySettings;
})(Amaterasu || (Amaterasu = {}));
var Amaterasu;
(function (Amaterasu) {
    const routes = {
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
    function mount(container, sdk, placement) {
        let disposed = false;
        const cleanups = new Set();
        const root = Amaterasu.el("div", "stats-plugin");
        container.append(root);
        const notice = Amaterasu.el("p", "stats-notice");
        notice.setAttribute("role", "status");
        root.append(notice);
        const visuals = new Set();
        const track = (control) => {
            visuals.add(control);
            queueMicrotask(() => { if (!root.contains(control.element)) {
                control.dispose?.();
                visuals.delete(control);
            } updateDrafts(); });
            return control;
        };
        const forms = new Map();
        const busy = new Set();
        const formState = (form) => JSON.stringify([...form.querySelectorAll("input,select,textarea")].map(control => [control.name, control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? control.checked : control.value]));
        const updateDrafts = () => {
            for (const form of root.querySelectorAll("form"))
                if (!forms.has(form))
                    forms.set(form, formState(form));
            for (const form of forms.keys())
                if (!root.contains(form))
                    forms.delete(form);
            sdk.setDirty([...forms].some(([form, initial]) => formState(form) !== initial));
        };
        root.addEventListener("input", updateDrafts);
        root.addEventListener("change", updateDrafts);
        const observer = new MutationObserver(() => { for (const control of visuals)
            if (!root.contains(control.element)) {
                control.dispose?.();
                visuals.delete(control);
            } updateDrafts(); });
        observer.observe(root, { childList: true, subtree: true });
        const ui = {
            ...(sdk.ui.dialog ? { dialog: (options) => sdk.ui.dialog(options) } : {}),
            metricGauge: options => track(sdk.ui.metricGauge(options)),
            metricChart: options => track(sdk.ui.metricChart(options)),
        };
        const context = {
            content: root, ui,
            setBusy(key, value) { if (value)
                busy.add(key);
            else
                busy.delete(key); sdk.setBusy(busy.size > 0); },
            api: {
                allows(scope) { return Object.values(routes).some(([alias, grant]) => grant === scope && sdk.canCall(alias)); },
                async post(route, payload = {}) {
                    const spec = routes[route];
                    if (!spec || disposed || sdk.signal.aborted)
                        throw new Error("Plugin method is unavailable.");
                    const result = await sdk.call(spec[0], payload);
                    if (disposed || sdk.signal.aborted)
                        throw new Error("Plugin surface closed.");
                    if (result && typeof result === "object" && result.ok === false) {
                        const error = new Error(String(result.message ?? "Request failed."));
                        Object.assign(error, { code: result.code });
                        throw error;
                    }
                    return result;
                },
            },
            notify(message) { if (!disposed)
                notice.textContent = message; },
            navigate() { },
            registerDraftGuard(_dirty, cleanup) { cleanups.add(cleanup); return () => cleanups.delete(cleanup); },
        };
        const dispose = () => { if (disposed)
            return; disposed = true; observer.disconnect(); for (const control of visuals)
            control.dispose?.(); visuals.clear(); for (const cleanup of cleanups)
            cleanup(); root.replaceChildren(); root.remove(); };
        sdk.signal.addEventListener("abort", dispose, { once: true });
        void sdk.assets.stylesheet("stats.css").then(() => {
            if (disposed || sdk.signal.aborted)
                return;
            if (!sdk.features.includes("ui.charts/1"))
                throw new Error("Statistics requires the charts SDK.");
            if (placement === "overview")
                Amaterasu.renderHostMetricsDashboard(context, root, undefined, "overview");
            else if (placement === "settings") {
                const telemetry = Amaterasu.el("div"), history = Amaterasu.el("div");
                root.append(telemetry, history);
                Amaterasu.renderHostMetricsSettings(context, telemetry);
                Amaterasu.renderHistorySettings(context, history);
            }
            else {
                Amaterasu.renderSessions(context);
                const settings = Amaterasu.el("details", "stats-preferences", Amaterasu.el("summary", "", "Statistics preferences"));
                root.append(settings);
                const telemetry = Amaterasu.el("div"), history = Amaterasu.el("div");
                settings.append(telemetry, history);
                Amaterasu.renderHostMetricsSettings(context, telemetry);
                Amaterasu.renderHistorySettings(context, history);
            }
        }).catch(error => { if (!disposed)
            root.replaceChildren(Amaterasu.errorPanel(error)); });
        return dispose;
    }
    window.AmaterasuExtensions.v1.register("stats", {
        title: "Statistics",
        mount: (container, sdk) => mount(container, sdk, "page"),
        mountOverview: (container, sdk) => mount(container, sdk, "overview"),
        mountSettings: (container, sdk) => mount(container, sdk, "settings"),
    });
})(Amaterasu || (Amaterasu = {}));

})();
