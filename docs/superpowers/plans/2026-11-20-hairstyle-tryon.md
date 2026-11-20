# ヘアスタイル試着アプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone Safari で動く、自分の顔写真に SNS の髪型を合成する（元の髪は消す）静的 Web アプリ。

**Architecture:** 素の ES モジュール。画像処理の純粋関数（幾何・マスク・穴埋め）を DOM から切り離してテストし、MediaPipe 呼び出しは `vision.js` に閉じ込める。`editor.js` が状態（変換・反転・消しゴム・履歴）を持ち、canvas に描画する。`app.js` が UI をつなぐ。

**Tech Stack:** HTML/CSS/JS（ビルドなし）、`@mediapipe/tasks-vision@0.10.14`（jsDelivr）、テストは Node 組み込み `node --test`、画面確認は既存の Playwright。公開は GitHub Pages（Actions）。

**Spec:** `docs/superpowers/specs/2026-11-20-hairstyle-tryon-design.md`

## Global Constraints

- 写真をネットワークに送らない。外部通信は CDN のライブラリとモデルファイル取得のみ
- 対象は iPhone Safari を最優先。MediaPipe は `delegate: "GPU"` で作成し、失敗したら `"CPU"` で作り直す
- 読み込んだ画像は長辺 1024px 以下に縮める
- 画面の文言は日本語。スマホ縦向き1画面、横スクロールなし、タップ対象は 44px 以上
- 依存はすべて CDN、バージョン固定。npm 依存なし（`package.json` はテストスクリプト用のみ）
- モデル URL:
  - 髪: `https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite`
  - 顔: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
  - WASM: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm`

## Review Focus

1. iPhone の 12MP 写真（4032×3024、HEIC）: 縮小して読み込み、メモリ不足で落ちないこと → Task 1 `scaledSize` テスト
2. 髪型写真に複数の顔が写っている: いちばん大きい顔を使うこと → Task 1 `pickLargestFace` テスト
3. 左右反転したとき: 反転後も髪が両目の位置に合ったままになること → Task 1 反転テスト
4. 自分の写真に髪がほとんどない（短髪・坊主）: 穴埋めが空振りしても壊れず、元画像がそのまま残ること → Task 2 空マスクのテスト
5. 消しゴムのあとで髪を動かす: 消した跡が髪と一緒に動くこと（跡は髪レイヤーの座標で持つ）→ Task 3 テスト
6. 写真を選び直した: 位置・反転・消しゴム・履歴がリセットされること → Task 3 テスト

---

## File Structure

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み |
| `css/style.css` | スタイル（ライト/ダーク対応） |
| `js/geometry.js` | 2×3 アフィン行列、目からの相似変換、ジェスチャー計算、顔選択、縮小サイズ |
| `js/mask.js` | マスクの膨張・ぼかし・差分、マスク→透明レイヤー |
| `js/fill.js` | 穴埋め（多段解像度の拡散） |
| `js/image-load.js` | File → 縮小済み canvas |
| `js/vision.js` | MediaPipe 初期化と `segmentHair` / `detectFaces` |
| `js/editor.js` | 編集状態と描画 |
| `js/app.js` | UI 配線、目タップ、保存 |
| `tests/*.test.js` | Node テスト |
| `package.json` | `{"type":"module","scripts":{"test":"node --test tests/"}}` |
| `.github/workflows/pages.yml` | GitHub Pages デプロイ |

マスクの型は全体で統一: `{ width: number, height: number, data: Float32Array }`（0〜1、行優先）。
行列の型: `[a, b, c, d, e, f]`（x' = a·x + c·y + e, y' = b·x + d·y + f。canvas `setTransform` と同じ並び）。
点の型: `{ x: number, y: number }`（ピクセル座標）。

---

### Task 1: 幾何計算 `js/geometry.js`

**Files:** Create `package.json`, `js/geometry.js`, `tests/geometry.test.js`

**Interfaces — Produces:**
- `multiply(m1, m2): Matrix`（m1 ∘ m2、先に m2 を適用）
- `invert(m): Matrix`
- `applyToPoint(m, p): Point`
- `similarityFromEyes(srcL, srcR, dstL, dstR): Matrix` — srcL→dstL, srcR→dstR
- `flipAround(width): Matrix` — x → width − x
- `gestureDelta(prevA, prevB, curA, curB): Matrix` — 2本指の移動・拡大・回転を表す行列（画面座標）
- `pickLargestFace(faces: Array<{ left: Point, right: Point, box: {width,height} }>): face | null`
- `scaledSize(w, h, maxSide = 1024): { width, height }`（整数に丸める）
- `eyeCentersFromLandmarks(landmarks, width, height): { left: Point, right: Point }` — 正規化座標のランドマークから、画像上の左目＝インデックス 33/133 の平均、右目＝362/263 の平均（画像上で左にある方を `left` にする）

- [ ] **Step 1: テストを書く**（`tests/geometry.test.js`、`node:test` と `node:assert/strict`。数値比較は 1e-6 の許容誤差）
  - `similarityFromEyes`: src `(10,10),(30,10)` → dst `(100,200),(140,200)` で、両目が一致し、`applyToPoint` で `(20,20)` → `(120,220)`
  - 回転: dst `(0,0),(0,20)` のとき src `(10,10),(30,10)` が dst に一致
  - `invert(m)` と `multiply(m, invert(m))` が単位行列
  - 反転テスト: 幅 100 の髪レイヤーで目 `(30,40),(70,40)`。`flipAround(100)` 適用後の目は `(70,40),(30,40)`。反転後の目の左右を入れ替えて `similarityFromEyes` を作り、`multiply(sim, flipAround(100))` が元の目を dst の両目に送る
  - `gestureDelta`: 2点が平行に (5,0) 動けば平行移動のみ、2点間距離が2倍なら中点を中心に拡大2倍
  - `pickLargestFace`: box 面積が最大のものを返す。空配列なら `null`
  - `scaledSize(4032, 3024)` → `{1024, 768}`、`scaledSize(800, 600)` → `{800, 600}`（拡大しない）
  - `eyeCentersFromLandmarks`: 33/133 が (0.2,0.5)/(0.3,0.5)、362/263 が (0.7,0.5)/(0.8,0.5)、幅1000×高さ500 → left `(250,250)`、right `(750,250)`
- [ ] **Step 2:** `npm test` → 失敗（モジュールが存在しない）
- [ ] **Step 3:** `js/geometry.js` を実装
- [ ] **Step 4:** `npm test` → 全件成功
- [ ] **Step 5:** コミット `feat: geometry helpers`

### Task 2: マスクと穴埋め `js/mask.js`, `js/fill.js`

**Files:** Create `js/mask.js`, `js/fill.js`, `tests/mask.test.js`, `tests/fill.test.js`

**Interfaces — Produces:**
- `dilate(mask, radius: number): Mask`（正方近傍の最大値。radius は px）
- `feather(mask, radius: number): Mask`（ボックスブラー2回）
- `subtract(a, b): Mask` — `max(0, a − b)`
- `threshold(mask, t = 0.5): Mask`（0/1 にする）
- `maskToLayer(rgba: Uint8ClampedArray, mask): Uint8ClampedArray` — アルファ = mask × 255
- `fillHoles(rgba: Uint8ClampedArray, width, height, hole: Mask): Uint8ClampedArray` — hole > 0.5 の画素を周囲から埋めた新しい配列を返す（入力は変更しない）

`fillHoles` のアルゴリズム（シグネチャとテストでは決まらないので指定）:
```
1. 画像と穴マスクを半分ずつ縮めたピラミッドを作る（各段: 穴でない画素だけの平均。2×2 がすべて穴なら穴のまま）。最小辺が 8px 以下になるまで繰り返す
2. 最小段: 穴の画素を、穴でない近傍4画素の平均で埋める処理を、穴がなくなるまで繰り返す
3. 上の段へ戻る: 穴の画素に下の段の値を双線形で拡大して入れ、穴の画素だけ4近傍平均の拡散を 8 回かける（穴でない画素は固定）
4. 最上段で、穴の画素だけを置き換えた配列を返す
```
1024×1024 で iPhone 相当の処理時間 1 秒程度を目安にする（Node では 300ms 以内を目安に計測して記録する。テストでは失敗にしない）。

- [ ] **Step 1: テストを書く**
  - `dilate`: 5×5 の中央1点、radius 1 → 3×3 が 1
  - `subtract`: `[1, 0.5, 0]` − `[0.3, 0.7, 0]` → `[0.7, 0, 0]`
  - `maskToLayer`: アルファが mask×255 になり、RGB は変わらない
  - `fillHoles`（空マスク）: 出力が入力と同じ
  - `fillHoles`（一様色）: 全体が (200,100,50)、中央 10×10 が穴で黒 → 穴の画素がすべて (200,100,50) ±1
  - `fillHoles`（左右2色）: 左半分が赤、右半分が青、中央の縦帯が穴 → 穴の左端は赤寄り（R > B）、右端は青寄り（B > R）
  - `fillHoles` で入力配列が変更されないこと
- [ ] **Step 2:** `npm test` → 失敗
- [ ] **Step 3:** 実装
- [ ] **Step 4:** `npm test` → 成功。512×512 の処理時間をログに出す
- [ ] **Step 5:** コミット `feat: mask ops and hole filling`

### Task 3: 編集状態と合成 `js/editor.js`

**Files:** Create `js/editor.js`, `tests/editor.test.js`

**Interfaces:**
- Consumes: Task 1 の行列関数、Task 2 の `dilate`, `subtract`, `threshold`, `fillHoles`
- Produces: `createEditor()` が返すオブジェクト:
  - `state`: `{ base: {width,height,rgba}|null, baseHair: Mask|null, layer: {width,height,rgba}|null, layerEyes: {left,right}|null, autoTransform: Matrix, transform: Matrix, flipped: boolean, strokes: Array<{points: Point[], radius: number}>, removeHair: boolean }`
  - `setBase(image, hairMask)` / `setLayer(image, eyes)` — どちらも `transform = autoTransform` に戻し、`flipped=false`、`strokes=[]`、履歴を空にする
  - `setBaseEyes(eyes)` — `autoTransform` を再計算し、`transform` に入れる
  - `applyGesture(delta: Matrix)` — `transform = multiply(delta, transform)`
  - `toggleFlip()` — 両目の中点を通る縦線で反転（`flipAround` と、左右を入れ替えた目からの相似変換を使う）
  - `addStroke(screenPoints, radius)` — 画面座標を `invert(effectiveTransform())` で髪レイヤー座標に変換して保存
  - `effectiveTransform(): Matrix` — 反転を含む最終的な行列（レイヤー座標 → 顔写真座標）
  - `undo()` / `reset()` — `pushHistory()` はジェスチャー終了・反転・ストローク追加ごと。`reset` は `transform=autoTransform`、`flipped=false`、`strokes=[]`
  - `layerAlphaInBase(): Mask` — 変換・消しゴム後の髪レイヤーのアルファを顔写真の座標で返す（Node でも動くよう、最近傍の逆写像サンプリングで純粋に計算する）
  - `holeMask(): Mask` — `threshold(subtract(dilate(baseHair, 6), dilate(layerAlphaInBase(), 2)))`。`removeHair` が false のときは全部 0
  - `render(ctx)` — 顔写真（`removeHair` なら `fillHoles` 済み）を描き、`setTransform(effectiveTransform())` で髪レイヤーを描く。消しゴムは髪レイヤーをオフスクリーン canvas に描いてから `destination-out` で消す
  - `autoTransform` は `layerEyes` と顔写真の目から作る。どちらかがなければ、レイヤーを顔写真の中央に置き、顔写真の幅の 0.8 倍に合わせる

- [ ] **Step 1: テストを書く**（canvas を使わない関数だけ。合成画像は 20×20 程度の小さなものを手で作る）
  - `setLayer` 後、`applyToPoint(effectiveTransform(), layerEyes.left)` が顔写真の左目に一致する
  - `toggleFlip` 後も両目が顔写真の両目に一致し、`flipped === true`
  - 消しゴムの追従: ストローク追加 → `applyGesture` で平行移動 (5,0) → `layerAlphaInBase()` の消えた位置も 5px 右に動く
  - `holeMask`: 顔写真の髪マスクのうち、髪レイヤーで隠れる部分は 0、はみ出す部分は 1
  - `removeHair=false` で `holeMask` が全部 0
  - `setLayer` を再度呼ぶと `strokes` が空、`flipped` が false、`undo()` しても何も起きない
  - `undo`: 反転 → undo で `flipped` が false に戻る
- [ ] **Step 2:** `npm test` → 失敗
- [ ] **Step 3:** 実装
- [ ] **Step 4:** `npm test` → 成功
- [ ] **Step 5:** コミット `feat: editor state and compositing`

### Task 4: 画像読み込みと MediaPipe `js/image-load.js`, `js/vision.js`

**Files:** Create `js/image-load.js`, `js/vision.js`

**Interfaces — Produces:**
- `loadImageFile(file: File): Promise<{ width, height, rgba: Uint8ClampedArray, canvas: HTMLCanvasElement }>` — `createImageBitmap(file, { imageOrientation: "from-image" })` で読み、失敗したら `<img>` + `URL.createObjectURL` で読む。`scaledSize` で縮めて canvas に描く
- `initVision(onProgress?: (msg: string) => void): Promise<{ segmentHair(canvas): Mask, detectFaces(canvas): Array<{left,right,box}> }>`
  - `FilesetResolver.forVisionTasks(WASM_URL)`、`ImageSegmenter.createFromOptions`（`outputConfidenceMasks: true`、`runningMode: "IMAGE"`）、`FaceLandmarker.createFromOptions`（`numFaces: 3`）
  - 各タスクを GPU で作り、例外なら CPU で作り直す
  - 髪のマスクは `confidenceMasks` のうち髪のクラス（hair_segmenter ではインデックス 1）を `Float32Array` にコピーして、`close()` する
  - `box` はランドマークの外接矩形（ピクセル）
  - 一度作ったものを使い回す（モジュール内でキャッシュ）

テストは Task 6 のブラウザ確認で行う（Node では MediaPipe を動かさない）。

- [ ] **Step 1:** 2ファイルを実装し、`import` をブラウザで読み込めることを確認する（Task 5 の画面で確認）
- [ ] **Step 2:** コミット `feat: image loading and vision wrapper`

### Task 5: 画面と配線 `index.html`, `css/style.css`, `js/app.js`

**Files:** Create `index.html`, `css/style.css`, `js/app.js`

**Interfaces — Consumes:** Task 3 の `createEditor`、Task 4 の `loadImageFile`, `initVision`、Task 1 の `gestureDelta`, `pickLargestFace`

画面（上から）:
1. タイトル「ヘアスタイル試着」、コツの一文「髪をまとめて、無地の壁の前で撮るときれいに仕上がります」
2. ボタン2つ「顔写真を選ぶ」「髪型写真を選ぶ」（`<label>` + 非表示の `<input type="file" accept="image/*">`）
3. プレビュー canvas（横幅いっぱい、`touch-action: none`）。上に状態表示（「読み込み中…」「髪を探しています…」など）
4. ツールバー: 「移動」「消しゴム」（太さ 小/中/大 = 10/20/40px）「左右反転」「元に戻す」「リセット」
5. トグル「元の髪を消す」（初期オン）
6. 「保存」ボタン

挙動:
- 写真を選ぶたびに `initVision` を待つ（初回のみモデルを読み込み、進み具合を表示）
- 顔が見つからないとき: 「顔写真の顔が見つかりませんでした」「髪型写真の顔が見つかりませんでした」のどちらかを表示し、目タップモードへ。その写真を表示して「左目をタップ」→「右目をタップ」。「スキップ」ボタンで中央配置
- 髪型写真で髪が見つからないとき: 「髪型写真から髪が見つかりませんでした」
- 指の操作: Pointer Events。移動モードでは1本指で平行移動、2本指で `gestureDelta`。消しゴムモードでは1本指でストローク。画面座標は canvas の表示倍率で写真座標に直す。指を離したら `pushHistory` と穴埋めの再計算（`requestAnimationFrame` で間引く）
- 保存: 顔写真の解像度でオフスクリーン canvas に `render` → `toBlob("image/jpeg", 0.92)` → `navigator.canShare({files})` が真なら `navigator.share({ files: [new File([blob], "hairstyle.jpg", {type:"image/jpeg"})] })`。それ以外は画像を全画面で表示して「長押しで保存できます」
- ダークモード: `:root` に色トークンを置き、`prefers-color-scheme: dark` で切り替える

- [ ] **Step 1:** 実装
- [ ] **Step 2:** `python3 -m http.server 8000` で配信し、Playwright（iPhone 13 エミュレーション）で開いて、コンソールエラーがないこと、横スクロールがないこと（`document.documentElement.scrollWidth <= innerWidth`）を確認
- [ ] **Step 3:** コミット `feat: UI and wiring`

### Task 6: ブラウザでの通し確認とデプロイ

**Files:** Create `.github/workflows/pages.yml`, `tests/e2e/smoke.mjs`, `tests/fixtures/`（テスト用の正面顔画像2枚。ライセンスが明確なもの、または生成画像）

- [ ] **Step 1:** `tests/e2e/smoke.mjs` を書く: iPhone 13 エミュレーションでページを開き、2つの input に画像を `setInputFiles` で入れ、状態表示が消えるまで待ち（最大 60 秒）、canvas が真っ白でないこと（ピクセルの分散 > 0）と、エラー表示が出ていないことを確認し、スクリーンショットを撮る
- [ ] **Step 2:** `node tests/e2e/smoke.mjs` を実行 → 成功。モデルのホストにネットワークで届かない場合は、そう記録して報告する（成功扱いにしない）
- [ ] **Step 3:** `.github/workflows/pages.yml`: `main` への push で、リポジトリ直下（`tests/` と `docs/` を除く）を `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4` で公開
- [ ] **Step 4:** README に使い方と公開手順（Settings → Pages → Source を「GitHub Actions」にする）を日本語で書く
- [ ] **Step 5:** コミットしてプッシュ `feat: e2e smoke test and Pages deploy`
