import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { RequestRecord, RequestStore } from "./core/request.js";

/**
 * Laptop storage for the request line: one JSON file, rewritten atomically (temp file + rename)
 * so the studio worker never reads half a file. The Cloudflare build swaps this for KV.
 */
export class JsonFileStore implements RequestStore {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  private read(): Record<string, RequestRecord> {
    try {
      return JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return {};
    }
  }

  async get(ticket: string): Promise<RequestRecord | undefined> {
    return this.read()[ticket];
  }

  async put(rec: RequestRecord): Promise<void> {
    const all = this.read();
    all[rec.ticket] = rec;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1));
    renameSync(tmp, this.path);
  }

  async list(): Promise<RequestRecord[]> {
    return Object.values(this.read());
  }
}
