# feat-197: セッション永続化（tmux ラッパー）

Issue: #197

## 決定事項（ユーザー確認済み）
- 方式: **tmux ラッパー**。`tmux -V` を検出し、**有れば PTY を tmux セッション内で起動**（サーバ死でもプロセス生存）、**無ければ現状どおり `pty.spawn`（非永続）にフォールバック**。
- 対象: **ランチャー（シェル/codex）＋ Claude セッション**。コマンドセルは対象外。

## アーキテクチャ
`tmux new-session -A -s mt-<id>` は「無ければ作成して program 実行・有れば attach（program は無視）」の1コマンドで、**初回起動と再起動後の再アタッチを両方カバー**。
- 分離 tmux サーバ（`-L mulmoterminal`）＋専用 conf（`status off` 等）でユーザーの tmux に一切干渉しない。
- サーバ死（crash / `node --watch` 再起動 / SIGTERM）では reap が走らない → tmux セッション生存 → 再起動時に lazy 再アタッチ。
- 明示クローズ（✕）・idle grace reap は `tmux kill-session` で確実に終了（生存サーバ内での孤児化を防ぐ）。

## 変更ファイル

### サーバ
- `server/tmux.ts`（新）: `tmuxAvailable()`（検出＋conf 書き出し）、`tmuxSessionName(id)`、`tmuxNewSessionArgs(id, file, args, cwd)`（`-A` create-or-attach、`-c cwd`）、`tmuxHasSession(id)` / `tmuxKillSession(id)` / `tmuxListSessionIds()`。bin はパラメータ経由で spawn（lint 回避）。
- `server/index.ts`:
  - `spawnPty(bin, args, opts)`（`pty.spawn` を param-bin でラップ）＋ `ptySpawn(id, file, args, opts, persistent)`（persistent && tmux 有 → `spawnPty("tmux", tmuxNewSessionArgs(...))`、else 直 spawn）。戻りに `tmux: boolean`。
  - `PtyEntry` に `tmux?: boolean`。`spawnClaudePty` / `spawnLauncherPty` を `ptySpawn(..., persistent=true)` に。`spawnCommandPty` は据え置き（非永続）。
  - `reap(id)`: `entry.tmux` なら `tmuxKillSession(id)`（node-pty kill は client を detach するだけなので）。
  - `/ws`・`/ws/launch` の id 解決に **tmux 生存チェック**を追加: `ptys` に無くても `tmuxHasSession(requested)` なら同 id で再アタッチ（Claude は warm、ランチャーも state 維持）。Claude は tmux 生存なら `--resume` 不要（attach が優先）。
  - 起動時: `tmuxListSessionIds()` を log（可視化）。孤児の自動掃除は v1 では行わない（生存を優先、follow-up）。

### テスト
- `server/tmux.spec.ts`: `tmuxSessionName` / `tmuxNewSessionArgs`（`-A`・`-c`・`--` の配置、bin 非依存）。
- e2e（実 tmux）: ランチャー起動 → シェルに状態を残す → **サーバ kill** → tmux セッション生存確認 → **サーバ再起動** → 同 id 再アタッチで状態生存を確認 → 後始末（kill-session）。

## スコープ外（v1）
マシン再起動での生存、コマンドセル永続化、孤児 tmux の自動掃除、複数クライアント同時アタッチの厳密制御。
