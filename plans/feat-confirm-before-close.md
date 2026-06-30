# feat: タブを閉じる/リロード前の確認ダイアログ

## User Prompt

> うっかりmulmoterminal閉じないように、タブ閉じそうなときにアラート出せる？

（クラリファイ結果）警告は **ターミナル（起動中のセッション/コマンドセル）が1つでもあるときだけ** 出す。空の画面・ランチャーのみなら出さない。

## 背景

- `claude` の PTY はサーバ側に存在し、WebSocket が切れると **アイドルなセッションは猶予後に reap**（`server/index.ts` の `handleClientClose`、トランスクリプトは残り `--resume` 可）、**working は生存**。なので「うっかり閉じ」には実害があり、ガードは有意義。
- ブラウザ仕様の制約: `beforeunload` は **閉じる・リロード・遷移すべてで発火**し区別不可。表示は **ブラウザ標準ダイアログ**で文面はカスタム不可。

## 設計

- `src/composables/useUnloadGuard.ts`（モジュール singleton、本リポジトリの既存流儀に合わせる）
  - `activeTerminals`(ref) … マウント中のビューが報告するライブ端末数。
  - `reportActiveTerminals(n)` … 各ビューが自分の権威データで更新。
  - `useUnloadGuard()` … `beforeunload` を1回だけ登録し、`activeTerminals > 0` のとき `preventDefault()`＋`returnValue=""` で標準ダイアログを出す。`onMounted`/`onUnmounted` で着脱。
- ビューは排他マウントなので、マウント中の1つが値を所有:
  - `App.vue`（single）… `useUnloadGuard()` を設置。`watch([viewMode, activeId])` で single のとき `activeId ? 1 : 0` を報告。
  - `GridView.vue`（grid）… `watch(() => runningCount(state.cells))` を報告（全ページ分をカウント）。

## テスト

- `useUnloadGuard.spec.ts` … 端末0で非ブロック / 端末ありでブロック / 0に戻ると非ブロック / unmount でリスナ解除。

## 留意点

- 文面はブラウザ依存（カスタム不可）、リロードでも発火（仕様）。
- single ビューは接続時に `activeId` が付くため、実質「セッション接続後は確認あり」。

## ゲート

`yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`
