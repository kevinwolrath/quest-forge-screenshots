import type { ArchiveBucket } from "../src/gallery.ts";
import type { MergeListing } from "../src/merges.ts";

export class MemoryBucket implements ArchiveBucket {
  objects = new Map<string, Uint8Array>();
  gets: string[] = [];
  puts: string[] = [];
  deletes: string[] = [];
  failPut = false;
  /** Fail only puts whose key matches, after earlier puts succeeded. */
  failPutKey: RegExp | null = null;
  failDelete = false;
  failList = false;

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    this.gets.push(key);
    const value = this.objects.get(key);
    if (!value) return null;
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return { arrayBuffer: async () => copy.buffer };
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.puts.push(key);
    if (this.failPut || this.failPutKey?.test(key)) throw new Error("put failed");
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    this.objects.set(key, copy);
  }

  /** R2's list: keys under the prefix, with `delimiter` folding deeper keys into prefixes. Two keys per page. */
  async list(options: { prefix: string; delimiter?: string; cursor?: string }): Promise<MergeListing> {
    if (this.failList) throw new Error("list failed");
    const objects: { key: string }[] = [];
    const prefixes = new Set<string>();
    for (const key of [...this.objects.keys()].sort()) {
      if (!key.startsWith(options.prefix)) continue;
      const rest = key.slice(options.prefix.length);
      const cut = options.delimiter ? rest.indexOf(options.delimiter) : -1;
      if (cut >= 0) prefixes.add(options.prefix + rest.slice(0, cut + 1));
      else objects.push({ key });
    }
    const all = [...prefixes].sort();
    const start = Number(options.cursor ?? 0);
    const page = all.slice(start, start + 2);
    const truncated = start + 2 < all.length;
    return { objects, delimitedPrefixes: page, truncated, cursor: truncated ? String(start + 2) : undefined };
  }

  async delete(keys: string[]): Promise<void> {
    if (this.failDelete) throw new Error("delete failed");
    for (const key of keys) {
      this.deletes.push(key);
      this.objects.delete(key);
    }
  }
}
