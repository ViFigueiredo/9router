"use client";

import PropTypes from "prop-types";

const STYLES = {
  ok: { label: "ok", cls: "text-green-500 bg-green-500/10 border-green-500/30" },
  slow: { label: "slow", cls: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  failing: { label: "failing", cls: "text-red-500 bg-red-500/10 border-red-500/30" },
  unknown: { label: "?", cls: "text-text-muted bg-sidebar border-border" },
};

const NOT_SERVED_STYLE = { label: "not served", cls: "text-amber-500 bg-amber-500/10 border-amber-500/40" };

function fmtMs(ms) {
  if (typeof ms !== "number") return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function ModelHealthBadge({ health }) {
  const notServed = !!health?.notServed;
  const tag = health?.tag || "unknown";
  const s = notServed ? NOT_SERVED_STYLE : (STYLES[tag] || STYLES.unknown);
  const showMetrics = !notServed && tag !== "failing" && (typeof health?.ttftAvgMs === "number" || typeof health?.tpsAvg === "number");
  const title = notServed
    ? [
      "Upstream says this model id is not served (HTTP 404) — the connection itself is fine",
      health?.lastErrorMessage ? health.lastErrorMessage.slice(0, 200) : "",
    ].filter(Boolean).join(" · ")
    : [
      health?.tag ? `tag: ${health.tag}` : "untested",
      health?.ttftAvgMs ? `avg latency ${fmtMs(health.ttftAvgMs)}` : "",
      health?.tpsAvg ? `avg ${health.tpsAvg} tok/s` : "",
      health?.updatedAt ? `updated ${new Date(health.updatedAt).toLocaleTimeString()}` : "",
      health?.lastErrorMessage ? `last error: ${String(health.lastErrorMessage).slice(0, 120)}` : "",
    ].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${s.cls}`}
    >
      <span>{s.label}</span>
      {showMetrics ? (
        <span className="inline-flex items-center gap-1 font-mono font-normal normal-case opacity-80 border-l border-current/25 pl-1">
          {typeof health?.ttftAvgMs === "number" ? <span>{fmtMs(health.ttftAvgMs)}</span> : null}
          {typeof health?.ttftAvgMs === "number" && typeof health?.tpsAvg === "number" ? (
            <span className="opacity-40">·</span>
          ) : null}
          {typeof health?.tpsAvg === "number" ? <span>{health.tpsAvg} tok/s</span> : null}
        </span>
      ) : null}
    </span>
  );
}

ModelHealthBadge.propTypes = {
  health: PropTypes.shape({
    tag: PropTypes.string,
    ttftAvgMs: PropTypes.number,
    tpsAvg: PropTypes.number,
    updatedAt: PropTypes.number,
    notServed: PropTypes.bool,
    lastErrorMessage: PropTypes.string,
  }),
};
