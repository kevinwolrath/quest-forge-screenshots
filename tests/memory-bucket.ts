import type { ArchiveBucket } from "../src/gallery.ts";

export class MemoryBucket implements ArchiveBucket {
  objects = new Map<string, Uint8Array>();
  gets: string[] = [];
  puts: string[] = [];
  failPut = false;

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
    if (this.failPut) throw new Error("put failed");
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    this.objects.set(key, copy);
  }
}
