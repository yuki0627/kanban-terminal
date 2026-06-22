# feat: グリッドのツールバーに ▶ Run プルダウンを追加

Issue: #97

## 背景 / 現状
- `script.json` の Run は **空きセルのランチャー内**（`TerminalCell` 未起動時の "or run a script"）にしか出ない。
- 走っているセルからは script を起動できず、一度 ＋Terminal で空きセルを足す必要がある。

## ゴール
グリッド上部ツールバーに **「▶ Run ▾」プルダウン** を置き、どの状態からでもデフォルト cwd の script を選んで **新しいセルで起動**できるようにする。

## 設計

### 新規 `RunMenu.vue`（再利用可能なドロップダウン）
- props: `cwd: string | null` — script を読むディレクトリ
- emits: `run { index, label, cwd }` — 解決後 cwd（`/api/scripts` のレスポンス cwd）を載せる
- 内部: 開いたときに `/api/scripts?cwd=<cwd>` を取得（request token で順序保証）。外側クリック / Esc で閉じる。スクリプト 0 件なら空表示。
- 「▶ Run ▾」ボタン＋ドロップダウン list。

### `gridTabs.ts`（純粋関数を追加・テスト対象）
```ts
// 空きセルで script を起動。末尾に空きランチャーがあれば再利用、なければ
// 新しい command cell を append（上限 MAX_TERMINALS 厳守）。最後のページへ移動。
export function runScriptInNewCell(state: GridState, command: NonNullable<Cell["command"]>): GridState
```

### `GridView.vue`
- ツールバー（＋Terminal の隣）に `<RunMenu :cwd="defaultCwd" @run="onRunNew" />`。
- `onRunNew(cmd)` → `state.value = runScriptInNewCell(state.value, cmd)`。

## 起動先の方針
- 常に**新しい / 空いているセル**で起動（現在のセルの Claude セッションは潰さない）。
- 末尾が空きランチャーならそれを command cell に変える。

## テスト
- `gridTabs.spec.ts`: `runScriptInNewCell`
  - 末尾が稼働セル → 新 command cell を append、最後のページへ
  - 末尾が空きランチャー → それを再利用（append しない）
  - 上限到達時は no-op
- `RunMenu.spec.ts`: fetch をモックし、開く→一覧表示→クリックで `run` emit / 外側クリックで閉じる

## ドキュメント
- `README.md` の「Scripts (Run menu)」に、ツールバーの ▶ Run はデフォルト cwd の script を空きセルで起動する旨を追記。

## 確認ゲート
`yarn format` / `lint` / `typecheck` / `build` / `test`。UI実機（ツールバー▶Run→一覧→選択で新セル起動／外側クリックで閉じる）は手元で目視確認。
