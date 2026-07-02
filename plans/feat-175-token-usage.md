# feat #175: セル別トークン使用量のインライン表示

## User Prompt
> 174/175は比較的簡単にできると思うので、すすめて。

（Issue #175）Accounting オーバーレイ（全体）はあるが、セル単位のトークン表示が無い。各セルにそのセッションの消費トークンをグランス表示したい。

## 背景（実コード）
- Claude の transcript(.jsonl) の `type:"assistant"` 行の `message.usage` に `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` がある。
- `accounting`（@mulmoclaude/accounting-plugin）は帳簿システムで、**Claude のトークンとは別物**。なので transcript を集計する。
- 各ターンの usage を合算＝セッションで実際に消費したトークン（毎ターン context を再送するので input は積み上がる。cache read は割引扱いで別集計）。サブスクなので $ ではなく**トークン数**を表示。

## 変更
### `server/transcript.ts`
- `SessionUsage`（inputTokens / outputTokens / cacheReadTokens / cacheCreationTokens）と `sessionUsageFromJsonl(raw)` を追加（assistant 行の usage を合算、非 assistant / usage 欠落 / 不正行は無視）。

### `server/index.ts`
- `/api/session/:id` を transcript の**単一読み込み**に変更し、`lastPrompt` と `usage` を同時に返す（`readSessionSummary`）。二重 read を避ける。

### `TerminalCell.vue`
- `usage` を `/api/session/:id`（`loadInitial`）から取得。**ターン終了（working→idle）で再取得**して最新化。teardown でリセット。
- ヘッダーに `⇡{入力合計} ⇣{出力}`（k/M 整形）のバッジ。tooltip で input/cache/output の内訳。トークン0のときは非表示。

## テスト
- `transcript.spec.ts`: `sessionUsageFromJsonl`（合算 / 無視 / 空）。
- `TerminalCell.spec.ts`: `/api/session/:id` の usage からバッジ表示・整形。

## 留意点
- 表示はトークン数（サブスクは $ 課金でないため）。
- transcript を毎回 read するが、既存の lastPrompt 取得と同コスト（endpoint は mount + ターン終了時のみ）。
- 常時表示（設定でのオン/オフは follow-up 候補）。

## ゲート
typecheck(client/server) / format / lint / build / test
