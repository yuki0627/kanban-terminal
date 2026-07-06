# Plan: レーン自動移動をフックレス化する(PR #3 差し替えコミット)

Codex 向け作業指示書。**このコミットは PR #3(ブランチ `codex/kanban-first-rebuild`)に
積む差し替えコミットであり、Phase 5-6 の前にマージする。**

## 最初に読むもの(この順で)

1. `docs/00-goal.md`「レーン自動移動」節・レイヤーモデル L3/L4 —
   本プランが実装する仕様そのもの。
2. `docs/09-open-questions.md` 論点2・論点4 — 決定の経緯と実測根拠。
3. `plans/feat-kanban-first-rebuild.md` Phase 3 — 親プランでの位置づけ。
4. 本プラン。

矛盾したら `docs/00-goal.md` が勝つ。判断に迷ったら作業を止めて報告する
(推測で仕様を埋めない)。

## 背景(なぜフックレス化するか)

PR #3 は Claude hook + PATH シム方式(カードのシェルの PATH 先頭にシムを
置き、`claude` 実行時に session ID と `--settings` を自動注入)で L3(エージェント
検知)を実装していた。**利用者判断によりこれを撤回する**: 「気軽に使いたい
ときにフックの設定をするのはハードルが高い」(2026-07-07)。

代わりに、サーバーが既に中継している **PTY のバイト流(入力・出力)** で
working / done を判定する。フック・シム・設定注入は一切不要になる。

判定仕様の実測根拠(tmux + pipe-pane で claude(haiku)の PTY 出力を記録、
2026-07-07)は `docs/09-open-questions.md` 論点2 を参照。要点だけ再掲:

- working 中の出力ギャップは最大 0.55 秒(無音ツール実行・WebSearch とも)。
- 完了後のアイドルは孤立した数バイトの再描画が数秒おきに 1 回あるのみ。
- 起動直後は約 1 秒のバースト描画のみで持続出力にならない。

## 撤去対象(`server/index.ts`。現状の実装位置は目安 — grep で確認すること)

PR #3 で追加された、**シム生成・PATH 注入だけ**を撤去する。既存の
`/api/hook` 受け口・`server/claude-args.ts`・hook 注入インフラ(mulmoterminal
由来の keep 対象)は削除しない(無害・残置)。

1. `CLAUDE_SHIM_DIR` 定数と `ensureClaudeShim()` 関数、起動時の呼び出し
   (`await ensureClaudeShim();`)を削除。
2. `withCardShellEnv()` から PATH 上書き(`CLAUDE_SHIM_DIR` を先頭に足す部分)
   と `KANBAN_TERMINAL_CLAUDE_SETTINGS`(`hookSettingsJson()` の注入)を削除。
   `KANBAN_TERMINAL_CARD_ID` / `KANBAN_TERMINAL_TERMINAL_SESSION_ID` は
   他で使われていないか grep で確認し、未使用なら一緒に削除、使われていれば残す。
3. `hookSettingsJson()` が上記削除後に呼び出し元を失うなら関数ごと削除
   (grep で呼び出し元がないことを確認してから)。
4. `~/.kanban-terminal/shims` ディレクトリを作る処理・README 等にシムへの
   言及があれば削除。

**削除してはいけないもの**: `/api/hook` ルート本体・`handleActivityHook()`・
`agentSessionToCard` Map・`server/claude-args.ts`。これらは mulmoterminal
由来の keep 対象であり、この差し替えの後も無害に残る(利用者がグローバル
hook 設定を手動で入れれば動く経路として温存する)。

## 追加実装: PTY 活動モニタ

### タップ地点(既存コードに実測済み)

- **入力(Enter 検知)**: `handleClientFrame()` の `msg.type === "input"` 分岐
  (`entry.term.write(msg.data)` の直前)。`msg.data` に含まれる `\r` を
  Enter とみなす。
- **出力(活動検知)**: `spawnLauncherPty()` 内の `term.onData((data) => {...})`
  (カードのシェルはこの経路で spawn される — `DEFAULT_LAUNCH_CMD` を
  `cardId` 付きで起動)。

新規の依存追加は不要(node-pty の既存イベントのみ)。

### 判定仕様(定数として名前付きでサーバーに置く)

```ts
const AGENT_OUTPUT_CONFIRM_MS = 1500; // Enter 後この時間内に持続出力が来たら working 開始
const AGENT_MIN_CHUNKS = 3; // 持続出力とみなす最小チャンク数
const AGENT_SILENCE_MS = 2000; // working 中にこの時間出力が止まったら done
```

判定ロジック(セッションごとの状態機械。カードのセッション ID をキーに保持):

1. エージェントが前面のときだけ動く(下記「エージェント検出」で判定)。
   前面がシェルまたはその他プロセスなら PTY 活動モニタは何もしない
   (L2 の既存プロセス検知に任せる)。
2. Enter 入力(`\r` を含む input フレーム)を検知したら、そこから
   `AGENT_OUTPUT_CONFIRM_MS` 以内に `AGENT_MIN_CHUNKS` 個以上の出力チャンクが
   来たら working 開始 → `applyBoardSignal(cardId, "working")` を呼ぶ
   (`l3StatusByCard` も更新し、既存の `suppressL2Signal` が効くようにする)。
   来なければ何もしない(Enter だけでは working にしない)。
3. working 中、出力が `AGENT_SILENCE_MS` より長く止まったら
   done → `applyBoardSignal(cardId, "done")`。**完了と承認待ちを区別しない**
   (blocked は発行しない — 利用者決定: ボールがユーザー側にあれば十分)。
4. Enter が先行しない出力(起動直後のバースト、resume 時の再描画、
   アイドル中の孤立した再描画)は working 判定のトリガーにしない
   (ルール2 がそのまま担保する — 追加の除外ロジックは不要)。

### エージェント検出(前面プロセスの 3 分岐)

既存の `isShellCommand()` / `isClaudeCommand()` は `tmuxPaneCurrentCommand()`
(`#{pane_current_command}`)の**コマンド名の単純一致**で判定しているが、
これは npm グローバルインストールの `claude` が `node` として見える場合に
機能しない可能性がある。**実装時に実測で確認すること**
(手元の `claude` インストール形態で `#{pane_current_command}` が
何を返すか、`tmux display-message -p '#{pane_current_command}'` で確認)。

- 単純一致で十分と実測で確認できた場合: 既存の `isClaudeCommand()` に
  `codex` も追加するだけでよい。
- 不十分だった場合: ペインの PID からプロセスツリーを辿り、コマンドライン
  (`ps -axo pid=,ppid=,args=` 等)に `claude` / `codex` がマッチするかで
  判定する処理を追加する。`server/process-memory.ts` の
  `currentProcessRows()` / `parsePsRows()` / `sumProcessTreeRss()` は
  pid・ppid・rss しか見ておらずコマンド名を返さないため、**そのままは
  再利用できない** — 同じ `ps` 呼び出し方針(`execFileAsync("ps", [...])`)を
  参考にしつつ、コマンド名も取得する新しい薄いヘルパーを
  `server/process-memory.ts` に追加するか、別ファイルに切り出すか判断する。

分岐は既存の `pollOneCardProcess()` / `isShellCommand()` の枠組みに乗せる:

```text
シェル(SHELL_COMMANDS に一致)     → 何もしない(L2 既存どおり、シグナル不在)
既知エージェント(claude / codex)  → PTY 活動モニタに委譲(このプランの本体)
その他プロセス                    → L2 既存どおり(開始→In Progress、終了→In Review)
```

`suppressL2Signal()` は既に「L3(`l3StatusByCard`)が立っている claude カード
では L2 の working シグナルを抑制する」という役割を持っている。PTY 活動モニタが
`l3StatusByCard` を更新する側になるだけで、この抑制ロジック自体は変更不要。

## セッション紐づけ(transcript 発見方式)

用途は **L4 resume とカード自動命名だけ**(レーン移動には session ID は
不要 — カード ID は tmux セッション ID からいつでも `terminalSessionToCard`
で引ける)。

- Claude: `~/.claude/projects/<cwd を / と . を - に置換したもの>/` 配下で、
  エージェント起動直後(Enter 検知から数秒以内)に新規作成された
  `<sessionId>.jsonl` を作成時刻の相関で発見する。既存の
  `projectSessionsDir()` / `sessionExistsOnDisk()` を流用できる。
- カード自動命名: 発見したセッション jsonl 内の `ai-title` 行
  (実測で存在確認済み — `type: "ai-title"` の行に会話タイトルが入る)を
  未命名カードの初期値に使う。
- 同一 cwd で複数カードが同時にエージェントを起動した場合、どの新規 jsonl が
  どのカードのものか曖昧になる既知の制約。過剰な tie-break 実装はしない
  (起動時刻が一番近いものを採用する程度でよい)。
- Codex は `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` に相当。今回の
  スコープでは resume/命名の実装は Claude Code のみ(論点4 決定どおり、
  Codex 対応は別プランで行う)。

## テスト

- 判定ロジック(Enter 検知 → 持続出力確認 → working、静止 → done)は
  **純関数に切り出して単体テスト**する(既存の `activityStatus` 等と同様、
  時刻とチャンク列を引数に渡す形にすればタイマー不要でテストできる)。
  必須ケース:
  1. Enter 後 `AGENT_OUTPUT_CONFIRM_MS` 以内に `AGENT_MIN_CHUNKS` 以上の
     出力 → working になる。
  2. working 中に `AGENT_SILENCE_MS` より長く出力が止まる → done になる。
  3. Enter が先行しない出力(起動バースト相当)→ working にならない。
- 受け入れ確認手順(実機、`yarn dev` で確認):
  1. カードのシェルで `claude` を起動しただけ(まだ何も頼んでいない)では
     レーンが動かないこと(起動直後のチラつきが無いこと)。
  2. プロンプトを投げて `sleep 20` 相当の無音ツールを実行させても
     In Progress のままキープされること(2 秒の静止判定で誤って
     In Review に落ちないこと)。
  3. WebSearch 等のネットワーク待ちでも同様に In Progress を保つこと。
  4. 応答が終わったら数秒以内に In Review へ動くこと。
  5. 手打ちの素のコマンド(`sleep 5 && echo done`)は既存の L2 どおり動くこと
     (このプランでリグレッションを起こさない)。

## サブエージェントへの委任時の注意(このプランを実行するエージェント自身にも適用)

サブエージェントに作業を分割する場合は、プロンプトに必ず次の 3 点を含める
(`~/.claude/rules/` はサブエージェントに自動継承されないため):

1. エラー時はフォールバックせず報告して停止する。
2. 指定した API・モデル・ツールが使えなくても、代替を自分の判断で試さない。
3. SDK・ライブラリの仕様は Context7 で確認する。

## ゲート

各ステップ後、必ず次を通してからコミットする(親プランの流儀を踏襲):

- `yarn format`
- `yarn lint`
- `yarn typecheck`
- `yarn typecheck:server`
- `yarn build`
- `yarn test`
- `yarn dev` で実起動し、上記「受け入れ確認手順」を人手または自動化スクリプトで確認

## やらないこと

- Codex(エージェント種別)の resume・自動命名の実装(論点4 決定どおり別プラン)。
- `kanbanBoard.ts` の遷移ルール変更(`laneForStatus` は working→in_progress、
  done/blocked→in_review で既に統合済みなので無変更でよい)。
- フロントエンドの `CellStatus`("blocked" を含む語彙)の変更 — PTY モニタは
  "blocked" を発行しないだけで、型やレーンマッピングは触らない。
- Phase 5(Archive UI)・Phase 6(リブランド)— 別コミット・別プランで扱う。
