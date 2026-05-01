# pin-quiz

日本の市区町村名を見て地図上にピンを刺す位置当てゲーム。

## 技術スタック

- 地図: Leaflet.js 1.9.4（CDN）+ CartoDB Positron（ラベルなし）タイル
- 境界線: TopoJSON Client 3（CDN）
- データ:
  - `data/municipalities.json` — 座標データ（`scripts/fetch-coordinates.js` で生成）
  - `data/municipality-borders.geojson` — 市区町村境界（`scripts/fetch-municipality-borders.js` で生成）
- フロント: 素の HTML/CSS/JS（フレームワークなし）
- ホスティング: Vercel（`push` で自動デプロイ）

## ファイル構成

```
index.html            スタート画面・ゲーム画面の HTML
style.css             スタイル
game.js               ゲームロジック全体
scripts/
  fetch-coordinates.js         座標データ生成
  fetch-municipality-borders.js 境界 GeoJSON 生成
data/
  municipalities.json          座標データ（Git 管理外）
  municipality-borders.geojson 境界データ（Git 管理外）
```

## データ生成

```bash
npm run fetch-coords    # data/municipalities.json を生成
npm run fetch-borders   # data/municipality-borders.geojson を生成
```

### fetch-coordinates.js

- `cities_quiz` の `municipality-dataset.json` を読み込み
- Wikipedia API（日本語版）の `prop=coordinates` で座標を取得
- `data/municipalities.json` に出力

### fetch-municipality-borders.js

- GADM 4.1（`gadm41_JPN_2.json`）から GeoJSON をダウンロード
- `data/municipality-borders.geojson` に出力
- ファイルサイズが大きいためリダイレクト対応済み

## ゲーム設定（スタート画面）

| 設定 | 選択肢 | デフォルト |
|------|--------|------------|
| 問題数 | 1〜30 | 5 問 |
| 都道府県名表示 | なし（重複市区町村のみ）/ 常に表示 | なし |
| 制限時間 | 0〜300 秒（0 = なし） | 0 秒 |

## スコアリング

境界データ (`municipality-borders.geojson`) がある場合、クリック点が対象市区町村の境界内なら **10点（満点）**。

境界外の場合は距離で判定：

| 距離 | 点数 |
|------|------|
| 0〜20 km | 9点 |
| 20〜50 km | 8点 |
| 50〜100 km | 7点 |
| 100〜200 km | 5点 |
| 200〜400 km | 3点 |
| 400〜700 km | 1点 |
| 700 km〜 | 0点 |

時間切れの場合は 0 点（ピンを刺していた場合もそのまま確定扱い）。

## 地図レイヤー構成

| Pane | zIndex | 用途 |
|------|--------|------|
| `municipalityPane` | 420 | 市区町村境界線（細線） |
| `prefecturePane` | 430 | 都道府県境界線（太線） |
| `highlightPane` | 450 | 正解市区町村のハイライト |

- 日本国外はグレーマスクで覆い、地図範囲を日本周辺に制限
- 都道府県境界・マスクは `dataofjapan/land` の `japan.geojson` を CDN から取得

## Vercel 設定

- プロジェクト ID: `prj_UijFefKLiwDxqP5053XBX9qXnnBB`
- `main` ブランチへの push で自動デプロイ
