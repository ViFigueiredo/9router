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
  const title = notServed
    ? [
      "Upstream says this model id is not served (HTTP 404) — the connection itself is fine",
      health?.lastErrorMessage ? health.lastErrorMessage.slice(0, 200) : "",
    ].filter(Boolean).join(" · ")
    : [
      health?.tag ? `tag: ${health.tag}` : "untested",
      health?.ttftAvgMs ? `avg ttft ${fmtMs(health.ttftAvgMs)}` : "",
      health?.updatedAt ? `updated ${new Date(health.updatedAt).toLocaleTimeString()}` : "",
      health?.lastErrorMessage ? `last error: ${String(health.lastErrorMessage).slice(0, 120)}` : "",
    ].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

ModelHealthBadge.propTypes = {
  health: PropTypes.shape({
    tag: PropTypes.string,
    ttftAvgMs: PropTypes.number,
    updatedAt: PropTypes.number,
    notServed: PropTypes.bool,
    lastErrorMessage: PropTypes.string,
  }),
};
