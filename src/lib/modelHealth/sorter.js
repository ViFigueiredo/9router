// Combines health tags with combo model resolution. Fail-open: any error or
// missing data leaves the model order untouched (today's behavior).
import { getModelInfo as getModelInfoDefault } from "@/sse/services/model.js";
import { getModelHealthByProvider } from "@/lib/db/repos/modelHealthRepo.js";
import { HEALTH_TAGS, classifyModel } from "./classifier.js";
import { reorderByRank } from "./comboOrder.js";

const RANK = { [HEALTH_TAGS.OK]: 0, [HEALTH_TAGS.UNKNOWN]: 0, [HEALTH_TAGS.SLOW]: 1, [HEALTH_TAGS.FAILING]: 2 };

export async function reorderModelsByHealth(models, deps = {}) {
  const getModelInfo = deps.getModelInfo || getModelInfoDefault;
  const readProvider = deps.readProvider || getModelHealthByProvider;
  if (!Array.isArray(models) || models.length <= 1) return models;

  try {
    const providerCache = new Map();
    const rankByModel = new Map();

    for (const str of models) {
      let rank = 0;
      try {
        const info = await getModelInfo(str);
        if (info && info.provider) {
          if (!providerCache.has(info.provider)) {
            providerCache.set(info.provider, await readProvider(info.provider).catch(() => ({})));
          }
          const map = providerCache.get(info.provider) || {};
          const mh = map[info.model];
          if (mh) {
            // Classify at read time from the live event window — never trust the
            // stored mh.tag, which can freeze stale (a row tagged `failing` whose
            // fatal events have aged out of the 1h window would stay deprioritized
            // forever without new observations). classifyModel returns UNKNOWN for
            // stale/empty windows, so such models fall back to rank 0.
            const { tag } = classifyModel(map, info.model, mh.kind, Date.now());
            rank = RANK[tag] ?? 0;
          }
        }
      } catch {
        rank = 0; // fail-open: unresolvable models keep their position
      }
      rankByModel.set(str, rank);
    }

    // deps.locked (combo position locks) wins over health: a locked model keeps
    // its exact index instead of being pushed to the tail when it fails.
    return reorderByRank(models, { locked: deps.locked, rankByModel, maxRank: 2 });
  } catch {
    return models;
  }
}
