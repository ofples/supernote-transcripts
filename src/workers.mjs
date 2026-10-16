// A rejected worker stops new dispatch, but every in-flight worker is awaited.
// This lets each successful paid result reach durable storage before returning.
export async function runWorkers(items, limit, work, mayStart = () => true) {
  let cursor = 0, failure, failed = false;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      try {
        if (!mayStart()) return;
        const item = items[cursor++];
        await work(item);
      } catch (error) { if (!failed) { failure = error; failed = true; } }
    }
  };
  await Promise.all(Array.from({length: Math.min(items.length, Math.max(1, limit))}, worker));
  if (failed) throw failure;
}
