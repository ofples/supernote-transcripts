import type { NotebookCheckOptions, OpenNotebook, ReadOnlySource } from "./types";

export interface DocumentSourceAdapter {
  id: string;
  matches(path: string): boolean;
  reader: ReadOnlySource;
}

/** Dispatches document operations to the single registered format owner. */
export class DocumentSources implements ReadOnlySource {
  private readonly adapters: readonly DocumentSourceAdapter[];

  constructor(adapters: DocumentSourceAdapter[]) {
    if (!Array.isArray(adapters) || adapters.length === 0)
      throw new Error("At least one document source adapter is required.");
    const ids = new Set<string>();
    this.adapters = adapters.map((adapter) => {
      if (!adapter || typeof adapter.id !== "string" || !adapter.id.trim() ||
          typeof adapter.matches !== "function" || !adapter.reader ||
          typeof adapter.reader.list !== "function" || typeof adapter.reader.revision !== "function" ||
          typeof adapter.reader.open !== "function")
        throw new Error("Invalid document source adapter.");
      if (ids.has(adapter.id)) throw new Error(`Duplicate document source adapter id: ${adapter.id}`);
      ids.add(adapter.id);
      return adapter;
    });
  }

  documentFormat(path: string): string | undefined {
    const matches = this.adapters.filter((adapter) => adapter.matches(path));
    if (matches.length > 1)
      throw new Error(`More than one document format claims this file: ${path}`);
    return matches[0]?.id;
  }

  supportsDocument(path: string): boolean {
    return this.documentFormat(path) !== undefined;
  }

  async list(folder: string, recursive: boolean, exclude: string[]) {
    const format = this.documentFormat(folder);
    if (format) {
      const adapter = this.byId(format);
      const entries = await adapter.reader.list(folder, recursive, exclude);
      return entries.filter((entry) => entry.path === folder && this.documentFormat(entry.path) === format);
    }

    const batches = await Promise.all(this.adapters.map(async (adapter) => ({
      adapter,
      entries: await adapter.reader.list(folder, recursive, exclude),
    })));
    const owned = new Map<string, { path: string; size: number; mtime: number }[]>();
    for (const { adapter, entries } of batches) {
      for (const entry of entries) {
        const owner = this.documentFormat(entry.path);
        if (owner !== adapter.id) continue;
        const rows = owned.get(entry.path) ?? [];
        rows.push(entry);
        owned.set(entry.path, rows);
      }
    }
    return [...owned.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, rows]) => rows.sort((a, b) => a.size - b.size || a.mtime - b.mtime)[0]);
  }

  revision(path: string): Promise<string> {
    return this.owner(path).reader.revision(path);
  }

  open(path: string, options?: NotebookCheckOptions): Promise<OpenNotebook> {
    return this.owner(path).reader.open(path, options);
  }

  async preview(path: string, pageNumber: number): Promise<string> {
    const reader = this.owner(path).reader;
    if (reader.preview) return reader.preview(path, pageNumber);
    const opened = await reader.open(path);
    try { return await opened.render(pageNumber); }
    finally { opened.close(); }
  }

  private owner(path: string): DocumentSourceAdapter {
    const id = this.documentFormat(path);
    if (!id) throw new Error(`No registered document format supports this file: ${path}`);
    return this.byId(id);
  }

  private byId(id: string): DocumentSourceAdapter {
    const adapter = this.adapters.find((candidate) => candidate.id === id);
    if (!adapter) throw new Error(`Unknown document source adapter: ${id}`);
    return adapter;
  }
}
