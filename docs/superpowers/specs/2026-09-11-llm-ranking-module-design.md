# LLM Ranking Module Design

## Problem

Health data exists per model (1h sliding window, tags `ok/slow/failing/unknown`) but
there is no global view of "which provider/model actually performs best", and no
accumulated history: `HEALTH_THRESHOLDS.windowMs` prunes events after 1h, so a model
that served well all week looks identical to one that was never measured.

## Goals

- A dashboard module **Ranking LLM**, placed above Usage, ranking providers and models.
- Ranking driven by accumulated validate outcomes (manual test and periodic
  revalidation), not only the 1h window.
- Show, per row: provider, model, validate data (tag, latency, tok/s, success rate,
  samples, last ping/error) and **which combos use that model, with position**.
- Reset accumulated counters per model or per provider.

## Non-Goals

- Renumbering combo order from the ranking (that is the next sub-project; it will
  consume `ranking.js`).
- Ranking media kinds against LLM (only same-kind normalization; separate cohorts).
- Changing the health window or the classifier rules.

## Decisions

| Decision | Choice |
| --- | --- |
| Score weights | Reliability 60% · Speed 30% · Recency 10% |
| Universe | Only models with at least one sample |
| Reset | Available per model and per provider |
| Combos column | Combo name + current position |

## Architecture

### Accumulated counters (no SQL migration)

`modelHealth` is JSON inside `kv(scope='modelHealth')`, so counters are added as a new
field — `SCHEMA_VERSION` does not change and no migration is needed.

```jsonc
"stats": {
  "ok": 12, "fail": 3,
  "ttftSumMs": 8123, "ttftCount": 12,
  "tpsSum": 540, "tpsCount": 10,
  "firstSeenAt": 1788…, "lastOkAt": 1788…, "lastFailAt": 1788…
}
```

Written by `recordObservation` in the same read-merge-write transaction as `events`
(`src/lib/db/repos/modelHealthRepo.js`). Only **ok** and **model-fatal** outcomes count:
401/403/429 are account/connection concerns, and counting them would rank a model by its
account's state (same rule the classifier already applies to `events`).

### Score (`src/lib/modelHealth/ranking.js`, pure)

- `reliability = ok / (ok + fail)`; below `minSamples = 3` → neutral `0.5`
  (a single lucky ping must not top the ranking).
- `speed`: average TTFT (lower better) and average TPS (higher better), min-max
  normalized **within the same `kind` cohort**; a cohort without spread → neutral.
- `recency`: half-life decay over `lastOkAt` age (24h half-life).
- Hard deprioritization: `tag === "failing"` or `notServed` sorts to the bottom
  regardless of score.
- `score = 100 * (0.6*reliability + 0.3*speed + 0.1*recency)`.

Entries carry an already-resolved `tag` (the caller classifies at read time, never
trusting the stored `tag` — same rule as `sorter.js`), so the module stays free of DB
and of window logic.

### API

- `GET /api/ranking?provider=&kind=&measuredOnly=` → `{ models: [...], providers: [...] }`.
  Reads all `modelHealth` rows (`getModelHealth()`), classifies each entry, joins the
  `combos` table for membership + position, ranks via `ranking.js`.
- `POST /api/ranking/reset` with `{ provider, model? }` → zeros the `stats` field
  (`resetModelStats`), leaving the 1h window untouched. Guarded by the standard
  dashboard auth (`src/dashboardGuard.js`).

### UI

`src/app/(dashboard)/dashboard/ranking/page.js`, registered in
`src/shared/components/Sidebar.js` immediately **before** the Usage entry:

- Tabs **Providers** (aggregate of its models) and **Models**.
- Filters: provider, kind; toggle "measured only" (on by default).
- Columns: rank, provider, model, tag badge, avg TTFT, tok/s, success rate,
  samples, last ping/last error, combos (name + `#position`).
- Score tooltip documents the weights; reset button per row and per provider
  (confirmation).

## Error Handling

- Ranking is read-only and fail-open: a provider whose row fails to parse is skipped.
- `stats` absent (old records, or after reset) → treated as zero samples.
- Reset never throws into the request: invalid provider → 400.

## Testing

- `tests/unit/model-health-ranking.test.js` (pure): ordering by score; reliability
  dominating speed; neutral below `minSamples`; `failing`/`notServed` at the bottom;
  per-kind normalization isolation; recency decay.
- `tests/unit/model-health-sink.test.js`: counters increment for ok/fatal only, and
  account-level failures (429) leave `stats` untouched.
- Visual: the module renders above Usage, lists measured models, shows combo
  membership, and the reset button empties that model's samples.

## Files Touched

- `src/lib/modelHealth/ranking.js` (new) — score + ordering, pure.
- `src/lib/modelHealth/sink.js` — accumulate `stats` on observation.
- `src/lib/db/repos/modelHealthRepo.js` — `resetModelStats`.
- `src/app/api/ranking/route.js`, `src/app/api/ranking/reset/route.js` (new).
- `src/app/(dashboard)/dashboard/ranking/page.js` (new).
- `src/shared/components/Sidebar.js` — nav entry above Usage.
- `tests/unit/model-health-ranking.test.js` (new), `tests/unit/model-health-sink.test.js`.
