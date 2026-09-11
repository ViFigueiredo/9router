# Provider/Model Auto-Revalidation Worker Design

## Problem

Model health tags (`ok` / `slow` / `failing` / `unknown`) are only ever written
when a user manually clicks a test action (`POST /api/providers/[id]/test-models`
or `POST /api/models/test`). Nothing refreshes them on its own, so badges decay
to `?` after the 1h sliding window (`HEALTH_THRESHOLDS.windowMs`) and a
provider that broke overnight is only discovered the next time someone opens the
dashboard and clicks validate.

There is no way for a user to say "re-check this provider every N minutes".

## Goals

- A server-side background worker that periodically re-validates providers and
  their models without manual clicks.
- The period is configurable **per provider** in the provider detail UI.
- The worker revalidates **both** the connection credential and the models.
- Opt-in: disabled by default, per provider.
- The configured period is bounded to `<= 60 min` so a healthy model never
  decays to `unknown` between runs.
- Reuse the existing ping, health-recording, and connection-test paths. No
  duplicated ping/record logic.

## Non-Goals

- Per-connection (per-account) intervals. Configuration is per provider and
  covers all of its active connections.
- Global/site-wide scheduling of unrelated jobs.
- Changing `HEALTH_THRESHOLDS.windowMs` or the classifier rules.
- Distributed locking for multiple server processes sharing one DB (see
  Limitations).
- New dependencies (no `node-cron`).

## Decisions

| Decision | Choice |
| --- | --- |
| What is revalidated | Connection credential **and** models |
| Config granularity | Per provider |
| Default state | Off (opt-in) |
| Interval bound | 5–60 minutes, presets `5/10/15/30/60` |
| Scheduler shape | One in-process `setInterval` tick + per-provider `nextRunAt` |
| Config storage | Global `settings` JSON, new `providerRevalidation` key |
| Execution order | Serial, one provider at a time |

## Architecture

### Config model

New key in the global settings row (`settings` table, `data` JSON — see
`src/lib/db/repos/settingsRepo.js`), following the existing `providerStrategies`
and `providerThinking` per-provider precedents:

```jsonc
"providerRevalidation": {
  "openai": {
    "enabled": true,
    "intervalMinutes": 30,
    "lastRunAt": 1788997527123,
    "lastStatus": "ok",      // "ok" | "partial" | "error"
    "lastError": null
  }
}
```

- Absent key / absent provider entry = disabled.
- `DEFAULT_SETTINGS.providerRevalidation = {}` is added to
  `src/lib/db/repos/settingsRepo.js` so `getSettings()` always returns an object.
- Read and written through the existing `GET` / `PATCH /api/settings`
  (`src/app/api/settings/route.js`). The UI performs the read-modify-write of the
  whole `providerRevalidation` map, exactly like `saveThinkingConfig` does for
  `providerThinking`.

### Worker service

New module `src/shared/services/providerRevalidation.js`, mirroring the
established shape of `src/shared/services/quotaAutoPing.js`:

- Process singleton on `global.__providerRevalidation` so Next.js HMR and
  re-imports never start a second scheduler.
- A **single** `setInterval` with `TICK_MS = 60_000`, not one timer per provider.
  Each tick iterates the configured providers and runs the ones whose
  `nextRunAt <= now`. This keeps reconfiguration trivial (no timer bookkeeping)
  and cannot leak timers.
- The interval handle is `unref()`-ed (same as the SQLite adapters' WAL
  checkpoint timers) so it never keeps the process alive.
- Enabling a provider (off -> on transition) schedules an immediate run rather
  than waiting for the next period.
- Execution is serial across providers. A per-provider in-flight guard prevents
  a slow cycle from overlapping its own next run.

Exports:

```js
startProviderRevalidation()                  // starts the tick if not running
stopProviderRevalidation()                   // clears the tick
configureProviderRevalidation(settings)      // start/stop + reschedule from settings
runProviderRevalidationTick(deps, state)     // one tick; deps injectable for tests
```

### Revalidation logic

The model-list resolution and the ping fan-out currently live inline inside
`POST /api/providers/[id]/test-models/route.js`. Extract them into
`src/lib/modelHealth/revalidate.js` so the route and the worker share one
implementation:

- `listProviderModels(providerId)` — the registry / live `/models` / custom-model
  resolution currently in the route (including the compatible-provider branch).
- `revalidateProviderModels(providerId, { connectionId })` — warm-up with the
  first model, `mapWithConcurrency(MODEL_TEST_BATCH.concurrency)`,
  `recordObservation()` per result, then `getHealthSnapshot()` to compute each
  result's `tag`.

The route becomes a thin wrapper that resolves the connection, calls
`revalidateProviderModels`, and shapes the same JSON response. This is a
behavior-preserving refactor; the existing routing test
(`tests/unit/provider-test-models-routing.test.js`) must stay green.

### Per-provider cycle

`revalidateProvider(providerId)`:

1. Load active connections ordered by priority
   (`getProviderConnections({ provider, isActive: true })`).
2. Run `testSingleConnection(id)` (`src/app/api/providers/[id]/test/testUtils.js`)
   for each, sequentially. That function already refreshes and persists
   credentials.
3. If **no** connection succeeds, set `lastStatus = "error"` and stop — do not
   spend model-ping tokens against a broken credential.
4. Otherwise run `revalidateProviderModels(providerId, { connectionId })` using
   the highest-priority connection that passed. Models are pinged **once per
   provider**, not once per connection, avoiding `connections x models` cost.
5. Persist `lastRunAt`, `lastStatus` (`ok` when every model ping succeeded,
   `partial` otherwise), and `lastError`.

### Lifecycle wiring

- Boot: in `runHeavyStartup()` inside
  `src/shared/services/initializeApp.js`, next to the existing
  `hasQuotaAutoPingEnabled` block:
  `if (hasProviderRevalidationEnabled(settings)) import(...).then(configureProviderRevalidation)`.
  The dynamic import keeps the module out of the graph when nobody opted in.
- Runtime reconfiguration: in `PATCH /api/settings`
  (`src/app/api/settings/route.js`), add a block beside the existing
  `claudeAutoPing` / `codexAutoPing` handler that calls
  `configureProviderRevalidation(settings)` when the request touched
  `providerRevalidation`.
- No provider enabled -> `stopProviderRevalidation()`.

### UI

`src/app/(dashboard)/dashboard/providers/[id]/page.js` (route param `id` is a
**provider id**, not a connection id):

- Read `settingsData.providerRevalidation?.[providerId]` in the existing settings
  fetch and hold it in a `revalidation` state.
- Render, in the same control strip as the round-robin toggle
  (`~page.js:1570`) and the thinking-level `<select>` (`~page.js:1759`), a
  "Auto-revalidar" `Toggle`, an interval `<select>` limited to
  `5/10/15/30/60`, and a small "última: HH:MM · status" readout.
- Save with a read-modify-write `PATCH /api/settings` carrying the full
  `providerRevalidation` map, mirroring `saveThinkingConfig`.

### Interval normalization

The service is the source of truth: `intervalMinutes` is coerced to an integer
and clamped into `[5, 60]`, falling back to `30` when missing or invalid. The UI
only offers presets. A stored out-of-range value from an older config or a
direct API call therefore cannot break the invariant that keeps the health badge
inside its 1h window.

### Error handling

- Every cycle is wrapped per provider; one failing provider never aborts the tick.
- `recordObservation` is already fail-open and never throws.
- `testSingleConnection` failures are captured as `lastError` (`message`
  truncated, like the auto-ping log style) and surfaced in the UI readout.
- Worker logs are prefixed `[Revalidate]` and use `console.log` / `console.warn`,
  matching `[AutoPing]`.

### Testing

- New `tests/unit/provider-revalidation.test.js`: pure scheduling behavior with
  injected deps — `nextRunAt` computation, `[5,60]` clamping and fallback,
  immediate run on off->on, and "credential failed => models not pinged".
- The extracted `revalidateProviderModels` is covered through the existing
  `tests/unit/provider-test-models-routing.test.js` (kind routing) plus a new
  assertion that it records observations.
- Smoke: start the server, `PATCH /api/settings` to enable one provider at
  5 minutes, observe `[Revalidate]` log output and refreshed tags from
  `GET /api/model-health?provider=<alias>`.
- Baseline files under `tests/__baseline__/` are not modified.

## Risks and Limitations

- **Real token cost.** Revalidation sends real upstream requests. Mitigations:
  opt-in, 5-minute floor, serial execution, and skipping model pings when the
  credential check fails.
- **Multiple server processes on one DB** would each run their own scheduler and
  duplicate pings. The app is currently single-process (`custom-server.js`), so
  this is documented rather than engineered around.
- **Settings write per cycle** (one `lastRunAt` update per provider per cycle,
  ~1/minute worst case) on a local SQLite DB. Acceptable; if it proves chatty,
  `lastRunAt` can move to in-memory state exposed through a read endpoint.

## Files Touched

- `src/shared/services/providerRevalidation.js` (new) — scheduler + cycle.
- `src/lib/modelHealth/revalidate.js` (new) — extracted model-list + ping logic.
- `src/app/api/providers/[id]/test-models/route.js` — thin wrapper over the
  extracted logic.
- `src/shared/services/initializeApp.js` — boot wiring.
- `src/app/api/settings/route.js` — runtime reconfiguration hook.
- `src/lib/db/repos/settingsRepo.js` — `providerRevalidation` default.
- `src/shared/constants/config.js` — `PROVIDER_REVALIDATION_CONFIG`
  (`tickIntervalMs`, `minIntervalMinutes`, `maxIntervalMinutes`,
  `defaultIntervalMinutes`).
- `src/app/(dashboard)/dashboard/providers/[id]/page.js` — per-provider UI.
- `tests/unit/provider-revalidation.test.js` (new).
