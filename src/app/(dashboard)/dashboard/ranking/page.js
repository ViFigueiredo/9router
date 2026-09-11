"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, SegmentedControl, Toggle, ConfirmModal } from "@/shared/components";
import ModelHealthBadge from "@/shared/components/ModelHealthBadge";

const TABS = [
  { value: "models", label: "Models" },
  { value: "providers", label: "Providers" },
];

const SCORE_TOOLTIP =
  "Score = 60% reliability (ok / ok+fail, neutral below 3 samples) + 30% speed (avg TTFT and tok/s, normalized inside each kind) + 10% recency (24h half-life on the last success). Models tagged failing or not served by upstream are always last.";

function fmtMs(ms) {
  if (typeof ms !== "number") return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtPct(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "—";
}

function scoreClass(entry) {
  if (entry.rank.deprioritized) return "text-red-500";
  if (entry.rank.score >= 80) return "text-green-500";
  if (entry.rank.score >= 60) return "text-amber-500";
  return "text-text-muted";
}

function ComboChips({ combos }) {
  if (!combos || combos.length === 0) return <span className="text-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {combos.map((combo) => (
        <Badge key={combo.id} variant="default" size="sm">
          {combo.name} <span className="opacity-60">#{combo.position}</span>
        </Badge>
      ))}
    </div>
  );
}

// Kept outside the component: no setState inside, so the effect can call it
// without tripping react-hooks/set-state-in-effect (same pattern as the
// providers page).
async function fetchRanking({ providerFilter, kindFilter, measuredOnly }) {
  const params = new URLSearchParams();
  if (providerFilter) params.append("provider", providerFilter);
  if (kindFilter) params.append("kind", kindFilter);
  params.append("measuredOnly", measuredOnly ? "true" : "false");
  const res = await fetch(`/api/ranking?${params}`, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export default function RankingPage() {
  const [tab, setTab] = useState("models");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [measuredOnly, setMeasuredOnly] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingReset, setPendingReset] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const body = await fetchRanking({ providerFilter, kindFilter, measuredOnly });
        if (!cancelled) {
          setData(body);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load ranking");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [providerFilter, kindFilter, measuredOnly, reloadKey]);

  // Filter changes come from event handlers (not effects), so the spinner can be
  // raised synchronously there without tripping react-hooks/set-state-in-effect.
  const changeProvider = (value) => { setLoading(true); setProviderFilter(value); };
  const changeKind = (value) => { setLoading(true); setKindFilter(value); };
  const toggleMeasuredOnly = () => { setLoading(true); setMeasuredOnly((v) => !v); };

  const models = useMemo(() => data?.models || [], [data]);
  const providers = useMemo(() => data?.providers || [], [data]);

  const providerOptions = useMemo(() => (
    [...new Set(models.map((m) => m.provider))].sort()
  ), [models]);

  const kindOptions = useMemo(() => (
    [...new Set(models.map((m) => m.kind))].sort()
  ), [models]);

  const confirmReset = async () => {
    if (!pendingReset) return;
    setResetting(true);
    try {
      await fetch("/api/ranking/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingReset),
      });
      setPendingReset(null);
      setLoading(true);
      setReloadKey((k) => k + 1);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl options={TABS} value={tab} onChange={setTab} className="w-full sm:w-auto" />
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={providerFilter}
            onChange={(e) => changeProvider(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
          >
            <option value="">All providers</option>
            {providerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => changeKind(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
          >
            <option value="">All kinds</option>
            {kindOptions.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-text-muted" title="Only models with at least one recorded validate sample">
            Measured only
            <Toggle checked={measuredOnly} onChange={toggleMeasuredOnly} />
          </label>
        </div>
      </div>

      <Card padding="none">
        <div className="flex items-center justify-between gap-2 border-b border-black/5 p-4 dark:border-white/5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-main">
              {tab === "models" ? "Model ranking" : "Provider ranking"}
            </h2>
            <span
              className="material-symbols-outlined cursor-help text-[16px] text-text-muted"
              title={SCORE_TOOLTIP}
            >
              info
            </span>
          </div>
          <span className="text-xs text-text-muted">
            {loading ? "Loading…" : `${tab === "models" ? models.length : providers.length} entries`}
          </span>
        </div>

        {error && <div className="p-4 text-sm text-red-500">{error}</div>}

        {!error && !loading && tab === "models" && models.length === 0 && (
          <div className="p-8 text-center text-sm text-text-muted">
            No measured models yet. Test a model (or enable per-provider auto-revalidation) to populate the ranking.
          </div>
        )}

        {!error && !loading && tab === "providers" && providers.length === 0 && (
          <div className="p-8 text-center text-sm text-text-muted">
            No measured providers yet.
          </div>
        )}

        {!error && tab === "models" && models.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-black/5 dark:border-white/5">
                  <th className="p-3 text-left text-xs font-semibold text-text-main">#</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Provider</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Model</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Validate</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main" title="Average time to first token (accumulated)">TTFT avg</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main" title="Average tokens per second (accumulated)">tok/s</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">OK / Fail</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">Success</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main" title={SCORE_TOOLTIP}>Score</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Combos</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">Reset</th>
                </tr>
              </thead>
              <tbody>
                {models.map((entry) => {
                  const ok = entry.stats?.ok || 0;
                  const fail = entry.stats?.fail || 0;
                  const total = ok + fail;
                  const avgTtft = entry.stats?.ttftCount > 0 ? entry.stats.ttftSumMs / entry.stats.ttftCount : null;
                  const avgTps = entry.stats?.tpsCount > 0 ? entry.stats.tpsSum / entry.stats.tpsCount : null;
                  return (
                    <tr key={`${entry.provider}/${entry.model}`} className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
                      <td className="p-3 text-xs font-mono text-text-muted">{entry.position}</td>
                      <td className="max-w-[160px] truncate p-3 text-xs font-medium text-text-main" title={entry.provider}>{entry.provider}</td>
                      <td className="max-w-[240px] truncate p-3 font-mono text-xs text-text-main" title={entry.model}>{entry.model}</td>
                      <td className="p-3">
                        <ModelHealthBadge
                          health={{
                            tag: entry.tag,
                            notServed: entry.notServed,
                            ttftAvgMs: avgTtft,
                            tpsAvg: avgTps,
                            updatedAt: entry.lastPingAt,
                            lastErrorMessage: entry.lastErrorMessage,
                          }}
                        />
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-text-main">{fmtMs(avgTtft)}</td>
                      <td className="p-3 text-right font-mono text-xs text-text-main">{typeof avgTps === "number" ? Math.round(avgTps) : "—"}</td>
                      <td className="p-3 text-right font-mono text-xs text-text-muted">{ok} / {fail}</td>
                      <td className="p-3 text-right font-mono text-xs text-text-main">{total > 0 ? fmtPct((ok / total) * 100) : "—"}</td>
                      <td className={`p-3 text-right font-mono text-sm font-semibold ${scoreClass(entry)}`}>{entry.rank.score.toFixed(1)}</td>
                      <td className="p-3"><ComboChips combos={entry.combos} /></td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setPendingReset({ provider: entry.provider, model: entry.model })}
                          title="Reset accumulated counters for this model"
                          className="rounded p-1 text-text-muted transition-colors hover:text-primary"
                        >
                          <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!error && tab === "providers" && providers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-black/5 dark:border-white/5">
                  <th className="p-3 text-left text-xs font-semibold text-text-main">#</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Provider</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">Models</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">OK / Fail</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">Success</th>
                  <th className="p-3 text-left text-xs font-semibold text-text-main">Top model</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main" title={SCORE_TOOLTIP}>Score</th>
                  <th className="p-3 text-right text-xs font-semibold text-text-main">Reset</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((row, index) => (
                  <tr key={row.provider} className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
                    <td className="p-3 text-xs font-mono text-text-muted">{index + 1}</td>
                    <td className="p-3 text-xs font-medium text-text-main">{row.provider}</td>
                    <td className="p-3 text-right font-mono text-xs text-text-muted">{row.models}</td>
                    <td className="p-3 text-right font-mono text-xs text-text-muted">{row.ok} / {row.fail}</td>
                    <td className="p-3 text-right font-mono text-xs text-text-main">{fmtPct(row.successRate)}</td>
                    <td className="max-w-[240px] truncate p-3 font-mono text-xs text-text-muted" title={row.topModel}>{row.topModel}</td>
                    <td className="p-3 text-right font-mono text-sm font-semibold text-text-main">{row.score.toFixed(1)}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setPendingReset({ provider: row.provider })}
                        title="Reset accumulated counters for every model of this provider"
                        className="rounded p-1 text-text-muted transition-colors hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={!!pendingReset}
        title="Reset accumulated counters?"
        message={pendingReset
          ? `This clears the ranking history for ${pendingReset.model ? `${pendingReset.provider} / ${pendingReset.model}` : `all models of ${pendingReset.provider}`}. The 1h health window and tags are kept.`
          : ""}
        confirmText={resetting ? "Resetting…" : "Reset"}
        onConfirm={confirmReset}
        onClose={() => setPendingReset(null)}
      />
    </div>
  );
}
