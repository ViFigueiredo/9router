// Combines health tags with combo model resolution. Fail-open: any error or
// missing data leaves the model order untouched (today's behavior).
import { getModelInfo as getModelInfoDefault } from "@/sse/services/model.js";
import { getModelHealthByProvider } from "@/lib/db/repos/modelHealthRepo.js";
import { HEALTH_TAGS } from "./classifier.js";

const RANK = { [HEALTH_TAGS.OK]: 0, [HEALTH_TAGS.UNKNOWN]: 0, [HEALTH_TAGS.SLOW]: 1, [HEALTH_TAGS.FAILING]: 2 };

export async function reorderModelsByHealth(models, deps = {}) {
  const getModelInfo = deps.getModelInfo || getModelInfoDefault;
  const readProvider = deps.readProvider || getModelHealthByProvider;
  if (!Array.isArray(models) || models.length <= 1) return models;

  try {
    const providerCache = new Map();
    const ranked = [];

    for (let i = 0; i < models.length; i += 1) {
      const str = models[i];
      let rank = 0;
      try {
        const info = await getModelInfo(str);
        if (info && info.provider) {
          if (!providerCache.has(info.provider)) {
            providerCache.set(info.provider, await readProvider(info.provider).catch(() => ({})));
          }
          const map = providerCache.get(info.provider) || {};
          const mh = map[info.model];
          rank = (mh && RANK[mh.tag]) ?? 0;
        }
      } catch {
        rank = 0; // fail-open: unresolvable models keep their position
      }
      ranked.push({ str, rank, i });
    }

    return ranked
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.str);
  } catch {
    return models;
  }
}
