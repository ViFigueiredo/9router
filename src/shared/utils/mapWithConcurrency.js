// Runs an async mapper over items with a bounded number of in-flight calls,
// preserving input order in the result. Sequential when limit <= 1.

export async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(limit) || 1));
  const results = new Array(list.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      results[i] = await mapper(list[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker));
  return results;
}
