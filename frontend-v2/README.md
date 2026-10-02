# COKOYO フロントエンド

## Pyxel UI 実験版（`codex/pyxel-ui`）

このブランチは、COKOYO の主画面を Python / Pyxel で描き直す実験版です。ホーム、フレンド、設定、キャンパスの建物一覧を Pyxel のキャンバスに描画します。キャラクターを歩かせるゲーム操作はありません。既存の React 版と完全に同じ表示・演出にはしていません。

Node.js 24 以上で、`frontend-v2/` から起動します。

```sh
npm ci
npm run dev:pyxel     # http://localhost:5173/（既定のポート）
npm run build:pyxel   # 型検査と Pyxel 版の dist/ ビルド
```

接続先を指定しなければ模擬バックエンドです。実 API の開発環境ではバックエンドを起動し、`http://localhost:5173/?api=/api` を開きます。実 API 向けのビルドは、PowerShell では次のように指定できます。公開時は `/api` を既存バックエンドへ転送してください。

```powershell
$env:VITE_API_BASE_URL = "/api"
$env:VITE_SHELL = "app"
npm run build
```

描画は `public/pyxel/ui.py`、ブラウザ内の起動処理は `public/pyxel/runtime.html` です。`src/pyxel/PyxelUI.tsx` が既存の `AppContext` と API を使い、同一オリジンの `postMessage` で表示状態と操作を受け渡します。認証、在校確認、フレンド関係の処理は既存の API 契約を使います。

日本語 IME による入力、初回登録、MAC アドレスの入力、写真の選択・切り抜き、QR・カメラ、共有、問い合わせには既存の HTML UI を重ねます。主画面のアバターはピクセル表示です。保存した写真データは保持し、写真の設定画面では確認・変更できます。説明・テスト用の React 画面とデモパネルも残しており、開発サーバーでは `?shell=explain` で切り替えられます。

ブラウザ実行環境は Pyxel **2.8.7** / Pyodide **0.29.3** を使い、固定版の外部 CDN を読み込みます。初回起動にはネット接続が必要で、この版ではオフライン動作を保証しません。PWA 対応の実験は別ブランチ `codex/mobile-pwa` です。日本語ビットマップフォントは `public/pyxel/fonts/umplus_j10r.bdf`、出典とライセンスは同じディレクトリの `NOTICE.txt` と `LICENSE_MPLUS.txt` にあります。

実ブラウザの確認用スクリプトは `tools/check-pyxel.mjs` です。インストール済みの Microsoft Edge を Playwright から起動し、Pyxel の実行環境とアプリ操作を確認します。別のターミナルでサーバーを起動してから実行してください（使用中のポートに合わせて URL を指定します）。

```sh
npm run dev:pyxel -- --host 127.0.0.1 --port 5175
```

```sh
node tools/check-pyxel.mjs "http://127.0.0.1:5175/?shell=app"
```

結果とスクリーンショットはリポジトリの `artifacts/pyxel-ui/` に出力されます。以下は既存 React 画面と共通機能の説明です。

React + Vite + TypeScript のアプリです。`keio.jp` Google ログイン後、表示名と最初の MAC を登録し、設定から最大 5 台の端末とプロフィール画像を管理します。Google の写真が取得できれば初期アイコンになり、利用者による変更・削除は保持されます。フレンドの在校、ポイント、地図、かくれんぼを表示します。フレンド追加は QR・招待リンク・共有キーを使います。X にはアプリのページだけを出し、ストーリーズの画像にはフレンド申請用の QR（招待リンクに `from=story` の印）を載せます。招待リンクを開いたときは、相手の名前を出して「申請しますか？」と確かめてから申請します（`src/phone/InviteConfirm.tsx`。はじめての人は登録が終わったところで出る）。QR はカメラのほか、写真（スクショ）からも読めます。写真やストーリーズの QR から読んだときは、目の前の相手とは限らないので申請になります。

## 起動

Node.js 24 以上。

```sh
npm ci
npm run dev       # http://localhost:5173/
npm run build     # 型検査と dist/ ビルド
npm run typecheck
```

環境変数がなければ模擬バックエンドです。説明用画面の「新規登録画面から始める」を使うとログインと登録を試せます。実 API を使うときは `http://localhost:5173/?api=/api` にアクセスし、先に `backend/` を起動してください。Vite は `/api` を `127.0.0.1:8080` に転送します。Google OAuth の callback URL と API の `APP_ORIGIN` は `http://localhost:5173` に合わせます。

## 画面と通信

- `src/phone/`: ログイン、初回登録、ホーム、フレンド、地図、設定、プロフィール画像と SNS 共有
- `src/api/client.ts`: 同一オリジン Cookie を送る API 呼び出し
- `src/api/mockBackend.ts`: `/test/` 用の模擬バックエンド。端末ごとの在校状態を切り替え可能
- `src/demo/`: 説明用の操作パネル、通信ログ、公開 DB 表
- `src/app/AppContext.tsx`: 画面状態と在校確認後の演出
- `src/field/`: キャンパスの描画
- `docs/api-for-backend.md`: API の現行契約

`VITE_SHELL=app` はアプリのみ、既定の `explain` はスマホ枠とデモ・通信ログを表示します。本番は `/` が実データのアプリ、`/explain/` が実データの説明画面（管理用パスワードが必要）、`/test/` が模擬データ、`/admin/` が管理画面（同じパスワード）です。説明画面の DB 表は全行を表示しますが、メール・Google ID・認証情報・MAC 原文・共有キーを除外します。

PWA はネットワーク優先で、`/api/` をキャッシュしません。カメラとサービスワーカーは HTTPS または localhost が必要です。

招待リンクには `openExternalBrowser=1` を付け、LINE から通常のブラウザで開きます。アプリ内ブラウザでは Google ログイン前に通常のブラウザで開く案内を表示します。画面復帰時と QR 表示中にはフレンド状態を裏で更新します。

## この版で足したもの

- MAC アドレスの調べ方は `src/phone/MacGuide.tsx`。端末の種類に加えて「キャンパスの内／外」を選べます。外からは、一度つないだ保存済みネットワークの設定から同じ値を見ます。初回登録と設定の「端末を追加」の両方で開けます。
- プロフィール画像は丸い枠に重ねて位置と大きさを決めます（`src/phone/AvatarPicker.tsx`）。枠に映っている範囲だけを 128px で送ります。
- ホームの木は月で色が変わります（3〜4月は桜、11月は紅葉、12〜2月は緑に雪、ほかは緑）。雨のときは細い雨とスライムが弾く輪を出します。どちらも CSS だけで、「動きを減らす」設定では出しません。
- 設定タブの「ご意見・問い合わせ」は Google フォームを開きます（`src/phone/Feedback.tsx`、URLは `src/config.ts` の `feedbackFormUrl`）。`/about/`・`/terms/`・`/privacy/` にも同じURLを直接書いています。
- 地図にβヴィレッジ（SBC）を足し、体育施設は Γ館と体育館を含む区画にしました。形は OpenStreetMap から起こしています。
- フレンドタブに「知り合いかも」を出します（`src/phone/Suggestions.tsx`）。ベストフレンドのフレンドか、共通のフレンドが2人以上の相手だけです（フレンドがまだ1人のあいだは、そのフレンドのフレンド全員）。画面には理由も人数も出さず、共通のフレンドの名前（3人まで）を出します。「出さない」を押した相手はこの端末では二度と出しません。設定タブの「知り合いかもに出す」で、自分を出さないようにもできます。

## 画像の書き出し

発表やお知らせに使う画像は `node tools/capture-shots.mjs`（`npm run dev` を動かした状態で）。
`docs/shots/` に、スマホの枠に収まった画面・ストーリーズ用の画像・アプリのアイコンが出ます。
枠は説明用の外枠（`?shell=explain`）が描いているものを切り出しています。

