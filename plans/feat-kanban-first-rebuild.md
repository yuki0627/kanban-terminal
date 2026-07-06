# Plan: 看板ファーストへの一括再構築(実装エージェント向け作業指示書)

## 最初に読むもの(この順で)

1. **`docs/00-goal.md`** — 本プロジェクトの憲法。すべての判断はここに従う。
   ゴール文書と本プランが矛盾したらゴール文書が勝ち、作業を止めて利用者に確認する。
2. **`docs/09-open-questions.md`** — 論点の経緯と決定の記録。
3. 本プラン — 作業の順序と範囲。

**大原則(ゴール文書より):** 看板ボードが主役、mulmoterminal は見えない土台。
ここに書かれていない仕様を推測で作り込まない。判断に迷ったら利用者に確認する。

## 絶対に壊してはいけないもの(keep リスト)

元祖 kanban-terminal が失敗した核心は「ターミナル層の自前実装」であり、
mulmoterminal のターミナル基盤を無傷で温存することが本プロジェクトの存在理由である。
以下は**リファクタ・「ついでの改善」も含めて触らない**(移動・rename は可、挙動変更は不可):

- サーバー: PTY spawn / tmux 永続化(`server/tmux.ts`)/ 3 段レジューム /
  hook 注入(`--settings` 生成)/ `/ws` ターミナル中継 / `/ws/pubsub` /
  `server/transcript.ts` / `server/claude-args.ts` / セッション発見とタイトル導出
- フロント: `src/composables/useTerminalConnections.ts`(xterm のモジュールシングルトン、
  attach/detach の DOM 再親化)/ `Terminal.vue` の xterm まわり / `usePubSub.ts` / `useSessions.ts`
- 看板の純ロジック `src/components/kanbanBoard.ts` の遷移ルール
  (エッジトリガー、idle は行き先ではない、手動完了保護)。拡張は可、ルール変更は不可。
- 通知系(**keep 決定**): `useAttentionSound` / `useSoundEnabled` /
  `useDynamicFavicon` / `useFaviconState` / `useNotifications` と関連サーバー部
  (attention sound の配信)。

## フェーズ構成

1 PR・フェーズごとに 1 コミット以上。**各フェーズの終わりに必ず
`yarn test` / `yarn lint` / `yarn typecheck` / `yarn typecheck:server` を通し、
`yarn dev` で実起動して看板が動くことを確認してからコミットする。**
機能を消すときは対応する spec も一緒に消す(テストを緑に保つ)。

### Phase 1: Mulmo エコシステムの削除

`server/index.ts` からの import を起点に配線を外し、不要ファイルを削除する。
**削除対象(カテゴリ)** — Accounting(帳簿)/ Collections / Feeds / Wiki /
PRs & Issues / GUI プラグイン基盤(GUI MCP・plugins-registry・PluginFrame・
GuiPanel)/ MulmoClaude 共有ワークスペース前提のバックエンド / 音声入力 /
Docker サンドボックス / worktree 機能。

代表ファイル(網羅ではない。**import を辿って完全に消す**こと):

- src: `AccountingOverlay.vue`, `Collection*.vue`, `Wiki*.vue`, `PrsOverlay.vue`,
  `GuiPanel.vue`, `PluginFrame.vue`, `useAccountingView.ts`, `accountingUi.ts`,
  `collectionUi.ts`, `useCollectionBrowse.ts`, `usePrsView.ts`, `useWikiBrowse.ts`,
  `pluginRuntime.ts`, `plugins-registry.ts`, `collectionShadowCss.ts`,
  `wikiApi.ts`, `wikiMarkdown.ts`, `wikiImageSrc.ts`, `useVoiceInput.ts`
- server: `accounting-tool.ts`, `host-tools.ts`, `plugins-registry.ts`, `mcp/`,
  `backends/`(accounting, collections, collectionWatchers, feeds, wiki,
  artifacts, image-gen, translation, whisper, workspaceSetup, scheduler,
  shortcuts, notifier ほか、上記 keep リストが使わないもの),
  `gh.ts`, `prs.ts`, `issues.ts`, `worktree*.ts`, `sandbox.ts`
- ルート: `/collections`, `/feeds`, `/accounting`, `/prs`, `/wiki*` と
  ツールバーの対応ボタン
- 依存: `@mulmoclaude/*` ほか、削除で不要になった package を `package.json` から外す
- `plans/` の Mulmo 由来プラン(`feat-product-profiles-freelance-books.md` 等)と
  `docs/` の Mulmo 由来文書(`collection-plugin-integration.md` 等)も削除

### Phase 2: 看板ファーストの外殻

- 看板ボードをルート `/` にする。Chat / Grid / Files / Run の各ビューと
  セッションサイドバー(`Sidebar.vue`)、`GridView` / `TerminalCell` /
  `CommandCell` / `LauncherCell` / `RunMenu` / `SessionTabBar` /
  `FilesOverlay` / `ToolsPane` 等を削除。
- ツールバーは看板用に作り直す(通知音トグル・Settings・Archive 入口程度の最小構成)。
- `App.vue` は「看板ボード+カード展開オーバーレイ」だけの外殻に書き直す。
  ターミナル本体(`Terminal.vue` + `useTerminalConnections`)は展開オーバーレイ内で
  現行 `/kanban` ビューと同じ方式(persist-key)で使い続ける。

### Phase 3: ドメインモデルと Projects sidebar

- **データモデル**: Project(id, root, 表示名, 色, sidebarVisible, 並び順)と
  Card(id, projectId | null, 名前, メモ, レーン, archived, unread,
  terminal 参照(sessionId, agentKind, cwd), 作成・更新時刻)。
- **サーバー側永続化**: ボード状態を `~/.kanban-terminal/board.json` 相当に保存する
  API(GET/PUT)を追加し、`KanbanView` を localStorage からこの API に載せ替える。
  変更は pub/sub で他クライアントへ通知(既存 `sessions` チャネルの流儀に従う)。
- **Projects sidebar**(元祖 `docs/04-ui-tui-spec.md` 準拠):
  折りたたみ式。通常プロジェクトと「Project なし」を同列に表示。
  プロジェクト = ディレクトリ選択だけで追加(表示名はフォルダ末尾名)。
  固有色。行クリック = カード表示/非表示トグル(0 件許容・空レーン表示)。
  行内にカード追加 `+`。
- **カード作成**: プロジェクト(または Project なし)に対して作成。
  ターミナル種別は Claude / プレーンシェルを選択。
  **ターミナルは遅延起動** — カード作成では起動せず、展開ウィンドウの
  ターミナル領域を最初に操作したときに起動する。
  cwd はプロジェクトの root(Project なしはホームディレクトリ)。
- **カード名**: セッションタイトルを自動初期値、手動上書き可。メモ編集可。
- **既存セッションの取り込み**: プロジェクト登録時に `/api/sessions?cwd=` の
  resume 候補を一覧し、選んだものをカード化。

**論点2 の MVP 既定値**(`docs/09-open-questions.md` 論点2): カードとセッションの
自動紐づけは**サーバーが `--session-id` を指定して spawn した場合のみ**。
プレーンシェル内で利用者が手で `claude` を打ったものは紐づけず、自動レーン移動
しない(仕様として README に明記)。

### Phase 4: ターミナル寿命ポリシー(常時サスペンド)

`docs/00-goal.md`「ターミナルの寿命」節の通り:

- カードのターミナルは**アイドルでも reap しない**(現行の「バックグラウンドで
  Stop → kill」を、カードのセッションについては無効化する。tmux 上で生かし続け、
  開いたら再アタッチ)。
- **Archive がターミナルを畳む唯一の解放ポイント**。実行中プロセスがあれば
  確認ダイアログ。カード上の明示終了操作も用意する。
- **メモリ可視化**: tmux ペイン PID からプロセスツリーの RSS を合算する API を
  追加し、カード単位のメモリと全体合計をボードに表示(控えめな常時表示)。

### Phase 5: 元祖 UI 機能(すべて MVP 範囲)

- Archive UI(**利用者の明示要望: 使い勝手を工夫する**。実装前に UI 案を
  2〜3 個モックで示し、利用者に選んでもらう — 元祖 `docs/ui-proposals/` 方式)
- 展開ウィンドウのサイズ・位置保存(利用者がドラッグで決めた値のみ保持 — 元祖仕様)
- 複数選択(ボード空白からの矩形選択)→ 一括 Archive
- unread マーカー(既存実装を維持)

### Phase 6: リブランドと npx 配布

- npm パッケージ名・bin を `kanban-terminal` に(空きは確認済み)。
  設定ディレクトリは `~/.kanban-terminal`。
- **単一インスタンス**(論点5 既定値): 起動時にポート使用中なら、それが
  kanban-terminal サーバーかを確認して既存をブラウザで開く(二重起動しない)。
- README を書き直す(看板ターミナルとしての説明+ mulmoterminal 由来の
  ターミナル基盤のクレジット。localhost 前提・認証なしも1行明記)。
- **AgentKind の継ぎ目**(論点4 既定値): spawn コマンド生成・hook →状態変換・
  resume コマンド生成をエージェント種別で差し替えられる薄いインターフェースを
  切る。実装は Claude Code のみ。Codex は作らない(別プランで対応)。

## やらないこと

- ターミナル永続化・画面復元の自前実装(最重要非ゴール)
- Codex 対応の実装(継ぎ目だけ)
- keep リストの挙動変更・「ついでの」リファクタ
- ゴール文書にない機能の追加

## 完了条件

- `npx`(ローカルでは `yarn dev`)で起動すると看板ボードが開き、
  プロジェクト追加 → カード作成 → ターミナル起動 → Claude 実行 →
  hook で In Progress / In Review へ自動移動 → 手動で Done → Archive で
  ターミナル解放(確認つき)、が一連で動く。
- カードを閉じて再度開くと、画面・実行中プロセスごと即復元される(サスペンド)。
- サーバー再起動後もカードとレーンが保持され、ターミナルは tmux 再アタッチで戻る。
- メモリ使用量がカード単位+合計で見える。
- 帳簿・Collections・Wiki・PRs・プラグイン関連のコード・ルート・依存・文書が
  リポジトリに残っていない(`grep -ri "accounting\|mulmoclaude\|collection"` 等で確認)。
- 全テスト・lint・typecheck(client / server)が緑。

## レビュー

実装完了後、レビュー担当(本プランの作成セッション)が上記完了条件と
ゴール文書への適合を確認する。フェーズ単位のコミットを保ち、
コミットを跨いだ巨大な squash はしないこと(レビュー可能性のため)。
