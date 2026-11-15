import { isAbsolute, resolve } from "node:path";

export interface ToolResult {
  toolName: string;
  input: unknown;
  details: unknown;
  isError: boolean;
}

export interface FileActivity {
  file: string;
  write: boolean;
  aiLineChanges?: number;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function abs(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

// omp edit diffs prefix changed rows with "+<line>|" or "-<line>|".
function countDiffLines(diff: string): number {
  let n = 0;
  for (const line of diff.split("\n")) if (/^[+-]\d+\|/.test(line)) n++;
  return n;
}

/** Files a finished omp tool call touched, with absolute paths. Failed calls touch nothing. */
export function fileActivity(result: ToolResult, cwd: string): FileActivity[] {
  if (result.isError) return [];
  const { toolName, input, details } = result;

  if (toolName === "read") {
    const source = field(field(details, "meta"), "source");
    const path = field(source, "type") === "path" ? str(field(source, "value")) : undefined;
    return path ? [{ file: path, write: false }] : [];
  }

  if (toolName === "write") {
    const path = str(field(details, "resolvedPath")) ?? str(field(input, "path"));
    return path ? [{ file: abs(path, cwd), write: true }] : [];
  }

  if (toolName === "edit") {
    const paths = field(input, "paths");
    if (Array.isArray(paths) && paths.length > 1) {
      return paths.flatMap((p) => (str(p) ? [{ file: abs(p, cwd), write: true }] : []));
    }
    const path = str(field(details, "path")) ?? str(field(input, "path"));
    if (!path) return [];
    const diff = str(field(details, "diff"));
    return [{ file: abs(path, cwd), write: true, ...(diff ? { aiLineChanges: countDiffLines(diff) } : {}) }];
  }

  return [];
}

/**
 * WakaTime plugin convention: send on writes, on entity changes, and otherwise
 * at most once per `intervalMs` for the same entity.
 */
export class Throttle {
  #entity: string | undefined;
  #at = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs = 120_000) {}

  shouldSend(entity: string, write: boolean, now: number): boolean {
    if (!write && entity === this.#entity && now - this.#at < this.intervalMs) return false;
    this.#entity = entity;
    this.#at = now;
    return true;
  }
}
