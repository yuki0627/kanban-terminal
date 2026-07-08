# feat: カード端末の Shift+Enter を Claude Code の改行として届ける

## User Prompt

> claudecodeでShift エンターで改行したいよね。なんかそれってデフォルトでできないのかな。
> (調査後) cmuxではそれがうまくできているので設定かもしれないですし、ロジックで回避しているかもしれないので、調査してみてください。
> (調査後) では、計画を作ってコーデックスに実装させてください。

## 背景

- 本アプリのスタックは xterm.js(ブラウザ) → WebSocket → node-pty → tmux → シェル/claude。
- ブラウザの KeyboardEvent には `shiftKey` があるが、xterm.js は Enter も Shift+Enter も
  同じ `\r` に畳んで送るため、pane 内の Claude Code は両者を区別できず、
  Shift+Enter が「送信」になってしまう。
- ネイティブ端末(Ghostty / cmux / iTerm2 等)は Kitty keyboard protocol (CSI u) で
  Shift+Enter を `ESC[13;2u` として区別して送る。ただし本アプリでこれを通すには
  xterm.js 側のプロトコル実装と tmux の extended-keys 対応(バージョン・設定依存)の
  両方が必要で、依存が多く脆い。
- Claude Code 公式の `/terminal-setup`(VS Code 等向け)は Shift+Enter に
  「`\` + Enter」(バックスラッシュ+改行 = Claude Code の行継続記法)を割り当てる方式。
  これはただのバイト列なので tmux を素通りし、素のシェルでは行継続(PS2)として
  自然に振る舞う。**本実装もこの方式を採る。**

## 設計

- `src/composables/useTerminalConnections.ts` の `ensure()` で
  `term.attachCustomKeyEventHandler` を登録する(現状カスタムキーハンドラは無い)。
- 判定ロジックは**純関数として export** し、テスト対象にする:
  - 対象イベント = `key === "Enter" && shiftKey` かつ ctrl / alt / meta なし、
    かつ IME 変換中でない(`isComposing || keyCode === 229` は素通し)。
  - 対象の `keydown` → PTY へ `"\\\r"`(バックスラッシュ + CR)を送出し、
    xterm の既定処理を抑止(ハンドラで `false` を返す)。
  - 対象の `keypress` / `keyup` → 送出なしで抑止(xterm が `\r` を生成しないように)。
  - それ以外のイベントはすべて xterm に委ねる(`true` を返す)。
- 送出は `term.onData` と同じ経路(スロットの現在の WebSocket へ `{type:"input"}`)。

## テスト

純関数の spec(vitest / jsdom):

1. Shift+Enter の keydown → `"\\\r"` 送出 + 抑止
2. 素の Enter → 素通し(送出なし)
3. Ctrl / Alt / Meta が併押しされた Enter → 素通し
4. `isComposing`(または keyCode 229)中の Shift+Enter → 素通し(日本語 IME の確定を壊さない)
5. Shift+Enter の keypress / keyup → 抑止するが送出はしない(二重送出防止)

## 留意点

- 素のシェルで Shift+Enter を押すと `\` + 改行 = 行継続(PS2 プロンプト)になる。
  これは VS Code + `/terminal-setup` と同じ挙動であり許容する。
- バックスラッシュ継続を解さない TUI(Codex CLI 等)では文字どおり `\` が入り得る。
  将来はエージェント種別(agent kind)ごとの差し替え点で調整できる。
- CSI u / Kitty keyboard protocol の本格対応は**非採用**(tmux の extended-keys
  依存でユーザー環境により壊れるため)。

## ゲート

`yarn format:check` / `yarn lint` / `yarn typecheck` / `yarn test` / `yarn build`

## 実施体制

計画: Claude / 実装: Codex CLI(codex exec, workspace-write sandbox) / 検証・PR: Claude
