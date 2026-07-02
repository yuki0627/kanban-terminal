# feat #178: グリッド状態サマリー（ツールバー集計）

## User Prompt
> 次のissue → （#173 は見送り）他はない？ → 「集計バッジ（推奨・最軽）」

多数エージェント運用で「別ページに手が要るセルがあるか」を一目で。既存 `statusForSort` を集計するだけ。#174 の blocked/done 状態に直結。

## 変更
- `gridTabs.ts`: `StatusCounts`（Record<CellStatus, number>）と `countByStatus(cells, statusByUid)`（占有セルのみ集計、空ランチャーは除外）。
- `GridView.vue`: `statusCounts = countByStatus(cells, statusForSort)` を computed し、`AppToolbar` に `:status-counts` で渡す。
- `AppToolbar.vue`: `statusCounts` prop、grid 時のみ（`inGrid`）「🔴blocked ⚪working 🔵done」の色ドット＋件数チップ、tooltip に内訳。何も動いていなければ非表示。App.vue（single）は渡さない＝非表示。
- 色: blocked=amber（要対応）、done=accent青（レビュー）、working=text-muted（ただ busy）。

## テスト
- `gridTabs.spec.ts`: `countByStatus`（占有集計 / 未報告=idle / command セル）。

## ゲート
typecheck / format / lint / build / test（565 通過）
