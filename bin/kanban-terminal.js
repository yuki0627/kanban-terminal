#!/usr/bin/env node

// kanban-terminal launcher — `npx kanban-terminal` entry point.
//
// Ships the server source (TypeScript) + a pre-built client (Vite dist/), and
// runs the server via tsx.

import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLatestVersion, isNewerVersion } from "./update-check.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 34567;
const READY_TIMEOUT_MS = 15_000;
// Server exit code meaning "port taken at bind time" — keep in sync with
// server/index.ts (PORT_IN_USE_EXIT_CODE).
const PORT_IN_USE_EXIT_CODE = 75;

// Single source of truth: read the version AND name from the shipped
// package.json so `--version`, the log prefix, and the update check never
// drift from the published package (the launcher itself is fork-agnostic).
const { version: VERSION, name: PKG_NAME } = createRequire(import.meta.url)("../package.json");

const log = (msg) => console.log(`\x1b[36m[${PKG_NAME}]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[${PKG_NAME}]\x1b[0m ${msg}`);

// Non-blocking notice when a newer version is published — `npm i -g` never
// auto-updates. Opt out via KANBAN_TERMINAL_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER.
function checkForUpdate() {
  if (process.env.KANBAN_TERMINAL_NO_UPDATE_CHECK || process.env.NO_UPDATE_NOTIFIER) return;
  fetchLatestVersion(PKG_NAME)
    .then((latest) => {
      if (latest && isNewerVersion(latest, VERSION)) {
        log(`\x1b[33mUpdate available: ${VERSION} → ${latest}  ·  run: npm i -g ${PKG_NAME}\x1b[0m`);
      }
    })
    .catch(() => {
      // best-effort; never disrupt startup
    });
}

function claudeInstalled() {
  try {
    // Intentionally resolves `claude` from the user's PATH — detecting their
    // Claude Code CLI install is the whole point of this pre-flight check.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function pickOpenCommand() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

// Resolve with true if nothing is listening on `port`, false otherwise. Binds
// 127.0.0.1 — same as the server's `server.listen(port, "127.0.0.1")` — so the
// probe and the real bind agree on availability.
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

// Poll the server until it answers, then call onReady; give up after the timeout
// so the launcher never hangs on a crash loop. Returns a cancel function — a
// raced/abandoned attempt stops polling so it can't fire a stale banner.
function waitUntilReady(port, onReady) {
  const startedAt = Date.now();
  let timer = null;
  let cancelled = false;
  const attempt = () => {
    if (cancelled) return;
    const req = httpGet({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      res.resume();
      if (!cancelled) onReady();
    });
    req.on("error", retry);
    req.on("timeout", () => {
      req.destroy();
      retry();
    });
  };
  const retry = () => {
    if (cancelled || Date.now() - startedAt > READY_TIMEOUT_MS) return;
    timer = setTimeout(attempt, 300);
  };
  attempt();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

function printReadyBanner(url) {
  const bar = "\x1b[32m" + "─".repeat(48) + "\x1b[0m";
  console.log(`\n${bar}`);
  console.log(`\x1b[32m  ✓ kanban-terminal is ready\x1b[0m`);
  console.log(`\x1b[32m  → ${url}\x1b[0m`);
  console.log(`\x1b[32m  Press Ctrl+C to stop.\x1b[0m`);
  console.log(`${bar}\n`);
}

function parsePortArg(args) {
  const idx = args.indexOf("--port");
  if (idx === -1) return { requestedPort: DEFAULT_PORT, portExplicit: false };
  const raw = args[idx + 1];
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw || parsed < 1 || parsed > 65535) {
    error(`Invalid --port value: "${raw ?? ""}" (expected integer 1..65535)`);
    process.exit(1);
  }
  return { requestedPort: parsed, portExplicit: true };
}

// Resolve the workspace directory claude runs in (and whose sessions the sidebar
// lists). Precedence: --cwd (relative paths allowed) > CLAUDE_CWD env > the
// directory npx was run from. Always returned absolute. An explicit --cwd that
// isn't an existing directory is a hard error (catches typos before launch).
function resolveCwd(args) {
  const idx = args.indexOf("--cwd");
  let flagValue;
  if (idx !== -1) {
    flagValue = args[idx + 1];
    if (flagValue === undefined || flagValue.startsWith("-")) {
      error("--cwd requires a directory path");
      process.exit(1);
    }
  }
  const chosen = flagValue ?? process.env.CLAUDE_CWD ?? ".";
  const abs = resolve(process.cwd(), chosen);
  if (idx !== -1 && (!existsSync(abs) || !statSync(abs).isDirectory())) {
    error(`--cwd is not a directory: ${abs}`);
    process.exit(1);
  }
  return abs;
}

function openBrowser(url) {
  try {
    // The command is a hardcoded literal; url is http://localhost:<numeric port>.
    execSync(`${pickOpenCommand()} ${url}`, { stdio: "pipe" });
  } catch {
    log(`Open your browser: ${url}`);
  }
}

function isKanbanTerminalServer(port) {
  return new Promise((resolve) => {
    const req = httpGet({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(res.statusCode === 200 && parsed?.app === "kanban-terminal");
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function choosePortAction(requested, noOpen) {
  if (await isPortFree(requested)) return { port: requested, start: true };
  const url = `http://localhost:${requested}`;
  if (await isKanbanTerminalServer(requested)) {
    log(`kanban-terminal is already running at ${url}`);
    if (!noOpen) openBrowser(url);
    return { port: requested, start: false };
  }
  error(`Port ${requested} is already in use by another process. Stop it or pass --port <number>.`);
  process.exit(1);
}

// Spawn the server on `port` and report the child via `onChild` (so signal
// handlers target the live process). The launcher never falls back to a different
// port; a port conflict is either an existing kanban-terminal instance or an error.
function runServer(port, noOpen, cwd, onChild) {
  return new Promise(() => {
    log(`Starting kanban-terminal on port ${port}...`);
    const server = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
      cwd: PKG_DIR,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), CLAUDE_CWD: cwd },
      stdio: "inherit",
    });
    onChild(server);

    const url = `http://localhost:${port}`;
    const cancelReady = waitUntilReady(port, () => {
      printReadyBanner(url);
      if (!noOpen) openBrowser(url);
    });

    server.on("exit", (code) => {
      cancelReady();
      if (code === PORT_IN_USE_EXIT_CODE) {
        error(`Port ${port} became unavailable before startup completed.`);
        process.exit(1);
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx kanban-terminal [options]

Options:
  --cwd <dir>       Working directory claude runs in (default: current directory; relative paths allowed)
  --port <number>   Server port (default: ${DEFAULT_PORT})
  --no-open         Don't open the browser automatically
  --version         Show version
  --help            Show this help
`);
    return;
  }
  if (args.includes("--version")) {
    console.log(`kanban-terminal ${VERSION}`);
    return;
  }

  checkForUpdate();

  if (!claudeInstalled()) {
    error("Claude Code CLI not found.");
    error("Install it first:  npm install -g @anthropic-ai/claude-code  &&  claude auth login");
    process.exit(1);
  }
  log("Claude Code CLI ✓");

  if (!existsSync(SERVER_ENTRY)) {
    error(`Server entry not found at ${SERVER_ENTRY}`);
    process.exit(1);
  }

  const { requestedPort } = parsePortArg(args);
  const noOpen = args.includes("--no-open");
  const cwd = resolveCwd(args);
  log(`Workspace: ${cwd}`);

  // Registered once; targets the live child when this launch starts a server.
  let child = null;
  const shutdown = () => {
    child?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const action = await choosePortAction(requestedPort, noOpen);
  if (!action.start) return;
  await runServer(action.port, noOpen, cwd, (c) => {
    child = c;
  });
}

main();
