import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The subscription setup: is the dive log's MCP server registered in Claude Code or Codex, which
 * version does it run, and the exact commands to (re)register it on this computer.
 */

export const SERVER_NAME = "ai-diving-monitor";

export type Runs = "typescript" | "python" | "other";

export interface AppStatus {
  app: "claude-code" | "codex";
  registered: boolean;
  /** Which server the registration starts. */
  runs: Runs | null;
  /** The command that registers the TypeScript server (after removing an old registration, if any). */
  commands: string[];
  /** Claude Code only: whether the /dive-review slash command is installed. */
  reviewCommandInstalled?: boolean;
}

interface Registration {
  command?: string;
  args?: string[];
}

export function runsOf(reg: Registration): Runs {
  const all = [reg.command ?? "", ...(reg.args ?? [])].join(" ");
  if (/mcp[\\/]server\.ts/.test(all)) return "typescript";
  if (/ai_diving_monitor\.mcp_server|ai-diving-monitor-mcp/.test(all)) return "python";
  return "other";
}

/** Claude Code keeps user-scope servers at the top of ~/.claude.json and project-scope ones per project. */
function claudeRegistration(home: string): Registration | null {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    if (config.mcpServers?.[SERVER_NAME]) return config.mcpServers[SERVER_NAME];
    for (const project of Object.values<{ mcpServers?: Record<string, Registration> }>(config.projects ?? {})) {
      if (project.mcpServers?.[SERVER_NAME]) return project.mcpServers[SERVER_NAME];
    }
  } catch {
    // No Claude Code configuration yet.
  }
  return null;
}

/** Codex keeps servers as [mcp_servers.<name>] tables in config.toml. */
function codexRegistration(home: string): Registration | null {
  const dir = process.env.CODEX_HOME?.trim() || path.join(home, ".codex");
  let toml: string;
  try {
    toml = fs.readFileSync(path.join(dir, "config.toml"), "utf8");
  } catch {
    return null;
  }
  const start = toml.search(new RegExp(`^\\[mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME})\\]\\s*$`, "m"));
  if (start < 0) return null;
  const body = toml.slice(start).split(/\n(?=\[)/)[0];
  const command = /^command\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(body)?.[1];
  const args = /^args\s*=\s*\[([^\]]*)\]/m.exec(body)?.[1];
  return {
    command: command?.replace(/\\\\/g, "\\"),
    args: args ? [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\\\/g, "\\")) : [],
  };
}

/** Bun, which runs the MCP server: ~/.bun/bin/bun when installed there, else whatever `bun` is on PATH. */
export function bunPath(home = os.homedir()): string {
  const local = path.join(home, ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  return fs.existsSync(local) ? local : "bun";
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

/** Environment the server needs to find the same data folder as this app. */
function envFlags(flag: string): string {
  return ["AI_DIVING_MONITOR_HOME", "AI_DIVING_MONITOR_DB", "AI_DIVING_MONITOR_CONFIG"]
    .flatMap((name) => (process.env[name]?.trim() ? [`${flag} ${name}=${quote(process.env[name]!.trim())}`] : []))
    .join(" ");
}

export function agentAppStatus(app: "claude-code" | "codex", repo = process.cwd(), home = os.homedir()): AppStatus {
  const reg = app === "claude-code" ? claudeRegistration(home) : codexRegistration(home);
  const server = `${quote(bunPath(home))} ${quote(path.join(repo, "mcp", "server.ts"))}`;
  const env = envFlags(app === "claude-code" ? "-e" : "--env");
  // The name goes before the environment flags: `-e` takes several values and would swallow it.
  const add =
    app === "claude-code"
      ? `claude mcp add --scope user ${SERVER_NAME} ${env ? `${env} ` : ""}-- ${server}`
      : `codex mcp add ${SERVER_NAME} ${env ? `${env} ` : ""}-- ${server}`;
  const remove = app === "claude-code" ? `claude mcp remove --scope user ${SERVER_NAME}` : `codex mcp remove ${SERVER_NAME}`;
  const runs = reg ? runsOf(reg) : null;
  const status: AppStatus = {
    app,
    registered: reg !== null,
    runs,
    commands: runs === "typescript" ? [] : reg ? [remove, add] : [add],
  };
  if (app === "claude-code") status.reviewCommandInstalled = fs.existsSync(path.join(home, ".claude", "commands", "dive-review.md"));
  return status;
}

/** Installs the /dive-review slash command for all Claude Code sessions. */
export function installReviewCommand(repo = process.cwd(), home = os.homedir()): void {
  const target = path.join(home, ".claude", "commands", "dive-review.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repo, ".claude", "commands", "dive-review.md"), target);
}
