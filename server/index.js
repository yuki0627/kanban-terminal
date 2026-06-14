import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createPubSub } from "./pubsub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3456;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME;

// Pub/sub channel the sidebar subscribes to for live session-activity changes.
const SESSIONS_CHANNEL = "sessions";

// Per-session "working" state, driven by Claude hooks (see /api/hook):
// UserPromptSubmit => Claude started thinking; Stop => it finished.
const activity = new Map(); // id -> { working, event, at }

// Assigned once the HTTP server exists (createPubSub needs it).
let pubsub = null;

// Update a session's working state and publish the change to subscribers.
// No-op (and no publish) when the state is unchanged.
function setWorking(id, working, event) {
  const prev = activity.get(id) || {};
  if (prev.working === working) return;
  activity.set(id, { working, event: event ?? prev.event ?? null, at: Date.now() });
  pubsub?.publish(SESSIONS_CHANNEL, { id, working, event: event ?? null });
}

// Hook config injected via `claude --settings <json>`. UserPromptSubmit and
// Stop both POST the hook payload (which includes session_id and
// hook_event_name) to /api/hook, which flips the session's working state.
function hookSettingsJson() {
  const cmd =
    `curl -s -X POST http://localhost:${PORT}/api/hook ` +
    `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({ hooks: { UserPromptSubmit: entry, Stop: entry } });
}

// Claude stores each project's sessions under ~/.claude/projects/<encoded-cwd>/,
// where the absolute cwd has its "/" and "." characters replaced by "-".
function projectSessionsDir(cwd) {
  const encoded = path.resolve(cwd).replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

// Scan a session JSONL for a human-friendly title and last activity.
async function readSessionMeta(dir, file) {
  const full = path.join(dir, file);
  const [raw, stat] = await Promise.all([
    fs.readFile(full, "utf8"),
    fs.stat(full),
  ]);

  let aiTitle = null;
  let lastPrompt = null;
  let firstUserMsg = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "ai-title" && o.aiTitle) aiTitle = o.aiTitle;
    else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = o.lastPrompt;
    else if (o.type === "user" && firstUserMsg === null) {
      let c = o.message?.content;
      if (Array.isArray(c)) {
        c = c.map((x) => (typeof x === "object" ? x.text || "" : x)).join(" ");
      }
      // Skip slash-command / local-command wrappers that aren't real prompts.
      if (typeof c === "string" && c.trim() && !/^\s*<(local-command|command-|bash-)/.test(c)) {
        firstUserMsg = c.trim();
      }
    }
  }

  const title = aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
  const id = path.basename(file, ".jsonl");
  return {
    id,
    title,
    mtime: stat.mtimeMs,
    working: activity.get(id)?.working ?? false,
  };
}

const app = express();
app.use(express.json());

// Serve Vite build output
app.use(express.static(path.join(__dirname, "../dist")));

// Claude hooks (Stop / Notification) POST their payload here so we can flag
// which background sessions have new activity.
app.post("/api/hook", (req, res) => {
  const { session_id, hook_event_name } = req.body || {};
  if (session_id) {
    if (hook_event_name === "UserPromptSubmit") setWorking(session_id, true, hook_event_name);
    else if (hook_event_name === "Stop") setWorking(session_id, false, hook_event_name);
    console.log(`[hook] ${hook_event_name} for ${session_id}`);
  }
  res.json({ ok: true });
});

// List the chat sessions for the current project (CLAUDE_CWD).
app.get("/api/sessions", async (_req, res) => {
  try {
    const dir = projectSessionsDir(CLAUDE_CWD);
    let files;
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (err.code === "ENOENT") return res.json({ cwd: CLAUDE_CWD, sessions: [] });
      throw err;
    }
    const sessions = (await Promise.all(files.map((f) => readSessionMeta(dir, f))))
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ cwd: CLAUDE_CWD, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

const server = http.createServer(app);
pubsub = createPubSub(server);

// Terminal WebSocket. Uses noServer + manual upgrade routing so it shares the
// HTTP server with socket.io (the pub/sub at /ws/pubsub) without the two
// libraries fighting over the "upgrade" event.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  }
  // Other paths (e.g. /ws/pubsub) are left to socket.io's own upgrade handler.
});

wss.on("connection", (ws, req) => {
  // ?session=<id> resumes an existing conversation; absent => fresh session.
  // For new sessions we generate the id ourselves (--session-id) so the server
  // always knows the current session's id, even before any file exists.
  const resume = new URL(req.url, "http://localhost").searchParams.get("session");
  const sessionId = resume || randomUUID();
  const settings = hookSettingsJson();
  const args = resume
    ? ["--resume", resume, "--settings", settings]
    : ["--session-id", sessionId, "--settings", settings];

  console.log(`[ws] client connected (${resume ? "resume" : "new"} ${sessionId})`);

  // Tell the browser which session this is (it learns the id of new sessions).
  ws.send(JSON.stringify({ type: "session", id: sessionId }));

  const term = pty.spawn(CLAUDE_BIN, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: CLAUDE_CWD,
    env: process.env,
  });

  console.log(`[pty] spawned claude (pid=${term.pid})`);

  // PTY -> browser
  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exited code=${exitCode} signal=${signal}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });

  // browser -> PTY
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") {
        term.write(msg.data);
      } else if (msg.type === "resize") {
        term.resize(msg.cols, msg.rows);
      }
    } catch {
      term.write(raw.toString());
    }
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected, killing pty");
    term.kill();
  });
});

server.listen(PORT, () => {
  console.log(`mulmoterminal running at http://localhost:${PORT}`);
});
