# feat-202: 対話しながら任意 MCP を追加して sandbox で動かす（MulmoClaude 相当）

Issue: #202

## 決定スコープ（ユーザー確認済み）
- **Docker sandbox + user-MCP は single view の Claude セッション専用**（`attachGuiMcp=true`）。grid（`?gui=0` dev terminal / launcher）は対象外。
- **tmux 永続化は grid 専用**。docker と tmux は**排他**な spawn ラッパ。single-view sandbox は docker（`--rm`・**非永続**、pty に紐づく）。
- 会話中の MCP 追加の反映 = **同 session id で `--resume` 再 spawn**。
- **opt-in・既定 OFF**（未設定なら現状どおり host で claude 起動）。まず対象 CLI は `claude` のみ。

## 現状把握（両リポ精読済み）
- 追い風: spawn 抽象 `ptySpawn`(`index.ts:1510`) が既にある（tmux を差し込んだのと同じ挿入点に docker を追加）。GUI MCP は既に **HTTP**（`/api/mcp/<id>`, `broker.ts:23` が「後で docker から到達できるように HTTP」と明記）＝ stdio broker 不要、**URL rewrite だけ**。config 追加型（`prRepos`/`launchers`）が確立。
- host 前提の loopback は2箇所: hook `curl http://localhost:PORT/api/hook`(`index.ts:603`) と MCP `http://127.0.0.1:PORT/api/mcp/<id>`(`index.ts:630`) → sandbox 時 `host.docker.internal` に rewrite。`~/.claude`(resume/transcript, `index.ts:638`) と cwd を bind mount。
- MulmoClaude 参照: `docker run --rm -i`(headless stream-json, 1msg1spawn) / stdio broker→host `/api/*` / `rewriteLocalhostForDocker`(`config.ts:116`) / stdio は既定 drop・opt-in `hostExecInDocker`(supergateway) / per-session mcp-config を workspace 直下に書く / credentials allowlist（gh/gitconfig, SSH agent）。

## 段階タスク（各段で動作確認）

### Phase 0 — 手動再現スパイク（低リスク・de-risk）※Docker daemon 要
- `Dockerfile.sandbox`（`node:22-slim` + `claude` + `curl`(hook) + `git`/`ripgrep`）。MulmoTerminal は GUI MCP が host の HTTP なので broker source 不要＝MulmoClaude より小さい。
- `scripts/sandbox-repro.sh`: image build → host で MulmoTerminal 起動想定 → `.session-token`/PORT を用意 → cwd + `~/.claude` を mount して `docker run --rm -it mulmoterminal-sandbox claude --mcp-config <host.docker.internal に rewrite> --settings <hook rewrite>` を起動。
- **完了条件**: container の claude REPL で `/mcp` に mulmoterminal-gui = connected、UI の状態ドットが hook で更新。

### Phase 1 — sandbox spawn（opt-in・single view）
- `server/sandbox.ts`(新): `sandboxEnabled()`(env/config), `buildDockerRunArgs(sessionId, claudeArgs, cwd, token, port)`（mounts / env / `--add-host`(linux) / image / `claude` ...）, `rewriteLoopbackForDocker(url)`（`localhost|127.0.0.1`→`host.docker.internal`）。
- `ptySpawn` に sandbox 分岐: `spawnClaudePty` が `sandbox = sandboxEnabled() && attachGuiMcp`（=single view）を判定 → docker ラッパ（tmux はスキップ）。
- `mcpConfigJson`/`hookSettingsJson` を sandbox 時 rewrite。session token を mount/env で container に渡し `/api/*`・`/api/hook`・`/api/mcp` を認証（既存 token 機構に合わせる）。
- **完了条件**: 対話 Claude セルがコンテナ内で動き、GUI MCP・状態・`--resume` が動作。

### Phase 2 — user HTTP MCP 管理
- `app-config.ts`: `userMcpServers: {id,url,headers?}[]` ＋ `sanitizeUserMcp`（launchers と同型）。`config-routes.ts` GET/POST ＋ `getUserMcpServers()`。
- `mcpConfigJson` に GUI MCP と並べてマージ（`--strict-mcp-config` は維持）。sandbox 時 URL rewrite。
- Settings UI に「MCP servers」エディタ（追加/削除）。
- **完了条件**: HTTP MCP を追加 → sandbox の Claude がその tool を呼べる。

### Phase 3 — 会話中の追加＋reload
- 追加/削除 → session の mcp-config 書換 → **同 id で `--resume` 再 spawn**（tmux/docker ラッパ経由）。UI に「Apply / Reload MCP」。
- **完了条件**: 会話中に MCP を足す → 次ターンで使える（会話継続）。

### Phase 4 —（後回し可）user stdio MCP: `hostExecInDocker` 相当 + supergateway shim。
### Phase 5 —（後回し可）credentials allowlist（gh/gitconfig, SSH agent forward）。

MVP = Phase 0→1→2→3。

## 要判断（Phase 1 着手時）
- session token 機構の詳細（既存の `.session-token`/認証があるか要確認）。
- image のビルド/配布（初回 `docker build` か publish/pull か）。
- non-docker（sandbox OFF）は現状 host 起動を完全維持。
