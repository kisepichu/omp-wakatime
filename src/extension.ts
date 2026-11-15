import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { delimiter, join } from "node:path";
import { type FileActivity, Throttle, type ToolResult, fileActivity } from "./activity.ts";

const VERSION = "0.1.0";

// Structural subset of omp's ExtensionAPI; avoids depending on the host package for types.
interface Context {
  cwd: string;
}
interface ExtensionAPI {
  pi: { VERSION?: string };
  logger: { warn(message: string): void; debug(message: string): void };
  on(event: "tool_result", handler: (event: ToolResult, ctx: Context) => void): void;
  on(event: "input" | "tool_call", handler: (event: unknown, ctx: Context) => void): void;
}

function findCli(): string | undefined {
  const exe = platform() === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, `wakatime-cli${exe}`))) return join(dir, `wakatime-cli${exe}`);
  }
  // wakatime-cli keeps its resources in $WAKATIME_HOME when set, else ~/.wakatime.
  const resources = process.env.WAKATIME_HOME?.trim() || join(homedir(), ".wakatime");
  const os = platform() === "win32" ? "windows" : platform();
  const cpu = arch() === "x64" ? "amd64" : arch() === "ia32" ? "386" : arch();
  // Editor plugins (vim-wakatime, vscode-wakatime, ...) install the CLI there.
  for (const name of [`wakatime-cli${exe}`, `wakatime-cli-${os}-${cpu}${exe}`]) {
    const path = join(resources, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export default function wakatime(pi: ExtensionAPI) {
  // `<editor>/<version> <editor>-wakatime/<version>` is the shape Wakapi parses into editor and OS.
  const plugin = `omp/${pi.pi.VERSION ?? "unknown"} omp-wakatime/${VERSION}`;
  const throttle = new Throttle();
  const lastFileByCwd = new Map<string, string>();
  let cli: string | null | undefined;

  const send = (activity: FileActivity, cwd: string) => {
    if (!throttle.shouldSend(activity.file, activity.write, Date.now())) return;
    if (cli === undefined) {
      cli = findCli() ?? null;
      if (!cli) pi.logger.warn("omp-wakatime: wakatime-cli not found on PATH or in ~/.wakatime; heartbeats disabled");
    }
    if (!cli) return;

    // No --sync-ai-disabled: wakatime-cli treats it as "AI tracking off" and drops every "ai coding" heartbeat.
    const args = ["--entity", activity.file, "--category", "ai coding", "--plugin", plugin, "--project-folder", cwd];
    if (activity.write) args.push("--write");
    if (activity.aiLineChanges !== undefined) args.push("--ai-line-changes", String(activity.aiLineChanges));

    // Detached so heartbeats never delay tools and still complete when omp exits.
    // wakatime-cli logs its own failures to ~/.wakatime/wakatime.log.
    const child = spawn(cli, args, { cwd, detached: true, stdio: "ignore" });
    child.on("error", (err) => pi.logger.warn(`omp-wakatime: failed to run wakatime-cli: ${err.message}`));
    child.unref();
  };

  // Activity without a file (prompts, bash, search) keeps the last file in this cwd alive.
  const keepAlive = (_event: unknown, ctx: Context) => {
    const file = lastFileByCwd.get(ctx.cwd);
    if (file) send({ file, write: false }, ctx.cwd);
  };

  pi.on("input", keepAlive);
  pi.on("tool_call", keepAlive);
  pi.on("tool_result", (event, ctx) => {
    const activities = fileActivity(event, ctx.cwd).filter((a) => isRegularFile(a.file));
    if (activities.length === 0) return keepAlive(event, ctx);
    for (const activity of activities) {
      lastFileByCwd.set(ctx.cwd, activity.file);
      send(activity, ctx.cwd);
    }
  });
}
