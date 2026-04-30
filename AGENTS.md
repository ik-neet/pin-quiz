# pin-quiz

日本の市町村名を見てピンを刺す地理クイズゲーム。

## 技術スタック

- 地図: Leaflet.js（CDN）+ CartoDB Voyager タイル
- データ: `data/municipalities.json`（`scripts/fetch-coordinates.js` で生成）
- フロント: 素の HTML/CSS/JS（フレームワークなし）

## データ生成

```bash
node scripts/fetch-coordinates.js
```

- `cities_quiz` の `municipality-dataset.json` を読み込み
- Wikipedia API（日本語版）の `prop=coordinates` で座標を取得
- `data/municipalities.json` に出力

## スコアリング

| 距離 | 点数 |
|------|------|
| 0〜10 km | 10点 |
| 10〜30 km | 9点 |
| 30〜50 km | 8点 |
| 50〜100 km | 7点 |
| 100〜200 km | 5点 |
| 200〜400 km | 3点 |
| 400〜700 km | 1点 |
| 700 km〜 | 0点 |
