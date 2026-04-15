import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseType } from "./discovery/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

export interface FileConnectorConfig {
  id: string;
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schemas?: string[];
  connectTimeout?: number;
  warehouseId?: string;
  projectId?: string;
  // Per-connector tuning
  lineageLookbackHours?: number;
  batchSize?: number;
  queryTextSequenceLimit?: number;
  waitTimeout?: string;
  maxPollIterations?: number;
  pollIntervalMs?: number;
  warehouse?: string;
  region?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  fetchTimeoutMs?: number;
}

export interface FileConfig {
  connectors: FileConnectorConfig[];
  discovery?: {
    connectTimeoutMs?: number;
  };
}

export class ConfigStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? resolve(PROJECT_ROOT, "config.json");
  }

  read(): FileConfig {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as FileConfig;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`Config file not found: ${this.filePath}`);
      }
      if (code === "EACCES") {
        throw new Error(`Permission denied reading config file: ${this.filePath}`);
      }
      throw new Error(`Failed to read config file ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Atomic write: write to temp file, then rename over original */
  write(config: FileConfig): void {
    const tmp = this.filePath + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(config, null, 2), "utf-8");
      renameSync(tmp, this.filePath);
    } catch (err: unknown) {
      try { unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES") {
        throw new Error(`Permission denied writing config file: ${this.filePath}`);
      }
      if (code === "ENOSPC") {
        throw new Error(`Disk full — cannot write config file: ${this.filePath}`);
      }
      throw new Error(`Failed to write config file ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateConnectors(connectors: FileConnectorConfig[]): void {
    const config = this.read();
    config.connectors = connectors;
    this.write(config);
  }

  getFilePath(): string {
    return this.filePath;
  }
}
