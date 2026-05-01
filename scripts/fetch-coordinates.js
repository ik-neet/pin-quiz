'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATASET = path.join(__dirname, '../../cities_quiz/data/wikipedia/normalized/municipality-dataset.json');
const RAW_MUNICIPALITIES_DIR = path.join(__dirname, '../../cities_quiz/data/municipalities/raw');
const OUTPUT = path.join(__dirname, '../data/municipalities.json');
const BATCH = 50;
const DELAY = 150;

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'pin-quiz/1.0 (educational; kz.still.awake@gmail.com)', ...headers },
    };
    https.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error(`parse failed (HTTP ${res.statusCode})`)); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toHiragana(text) {
  return String(text || '').replace(/[\u30a1-\u30f6]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function loadKanaByCode() {
  if (!fs.existsSync(RAW_MUNICIPALITIES_DIR)) {
    return new Map();
  }

  const candidates = fs.readdirSync(RAW_MUNICIPALITIES_DIR)
    .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();

  if (!candidates.length) {
    return new Map();
  }

  const latestPath = path.join(RAW_MUNICIPALITIES_DIR, candidates[0]);
  const raw = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  const items = raw.items || [];

  return new Map(items.map(item => [
    item.rawCode,
    toHiragana(item.rawKana || ''),
  ]));
}

function loadMetadataByCode() {
  if (!fs.existsSync(RAW_MUNICIPALITIES_DIR)) {
    return new Map();
  }

  const candidates = fs.readdirSync(RAW_MUNICIPALITIES_DIR)
    .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();

  if (!candidates.length) {
    return new Map();
  }

  const latestPath = path.join(RAW_MUNICIPALITIES_DIR, candidates[0]);
  const raw = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  const items = raw.items || [];

  return new Map(items.map(item => [
    item.rawCode,
    {
      kana: toHiragana(item.rawKana || ''),
      type: item.rawType || null,
      parentMunicipality: item.rawParentMunicipality || null,
    },
  ]));
}

// Step 1: Wikipedia titles → Wikidata QIDs (prop=pageprops)
async function fetchQids(titles) {
  const t = titles.map(t => encodeURIComponent(t)).join('|');
  const url = `https://ja.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&titles=${t}&format=json&redirects=1`;
  const data = await httpGet(url);

  const norm = new Map((data.query.normalized || []).map(n => [n.from, n.to]));
  const redir = new Map((data.query.redirects || []).map(r => [r.from, r.to]));

  const resolve = (orig) => {
    let t = norm.get(orig) || orig;
    for (let i = 0; i < 5; i++) { const n = redir.get(t); if (!n) break; t = n; }
    return t;
  };

  const qidByTitle = new Map();
  for (const page of Object.values(data.query.pages || {})) {
    const qid = page.pageprops?.wikibase_item;
    if (qid) qidByTitle.set(page.title, qid);
  }

  const result = new Map();
  for (const title of titles) {
    const resolved = resolve(title);
    const qid = qidByTitle.get(resolved);
    if (qid) result.set(title, qid);
  }
  return result;
}

// Step 2: Wikidata QIDs → coordinates (wbgetentities)
async function fetchCoordsForQids(qids) {
  const ids = qids.join('|');
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims&format=json`;
  const data = await httpGet(url);

  const result = new Map();
  for (const [qid, entity] of Object.entries(data.entities || {})) {
    const claims = entity.claims?.P625;
    if (!claims?.length) continue;
    const snak = claims[0].mainsnak?.datavalue?.value;
    if (snak?.latitude != null) {
      result.set(qid, { lat: snak.latitude, lng: snak.longitude });
    }
  }
  return result;
}

async function main() {
  if (!fs.existsSync(DATASET)) {
    console.error(`データファイルが見つかりません:\n  ${DATASET}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(DATASET, 'utf-8'));
  const items = raw.items || raw;
  const metadataByCode = loadMetadataByCode();
  console.log(`市町村数: ${items.length}`);

  // Step 1: get all QIDs
  console.log('\n[Step 1] Wikipedia → Wikidata QID');
  const titleToQid = new Map();
  const totalBatches1 = Math.ceil(items.length / BATCH);
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const titles = batch.map(m => m.wikipediaTitle);
    process.stdout.write(`  バッチ ${Math.floor(i / BATCH) + 1}/${totalBatches1} ... `);
    const qids = await fetchQids(titles);
    for (const [t, q] of qids) titleToQid.set(t, q);
    console.log(`${qids.size}/${batch.length} QID取得`);
    if (i + BATCH < items.length) await sleep(DELAY);
  }
  console.log(`QID合計: ${titleToQid.size}/${items.length}`);

  // Step 2: get coordinates from Wikidata
  console.log('\n[Step 2] Wikidata QID → 座標');
  const allQids = [...new Set(titleToQid.values())];
  const qidToCoord = new Map();
  const totalBatches2 = Math.ceil(allQids.length / BATCH);
  for (let i = 0; i < allQids.length; i += BATCH) {
    const batch = allQids.slice(i, i + BATCH);
    process.stdout.write(`  バッチ ${Math.floor(i / BATCH) + 1}/${totalBatches2} ... `);
    const coords = await fetchCoordsForQids(batch);
    for (const [q, c] of coords) qidToCoord.set(q, c);
    console.log(`${coords.size}/${batch.length} 座標取得`);
    if (i + BATCH < allQids.length) await sleep(DELAY);
  }

  // Step 3: assemble output
  const results = [];
  let missing = 0;
  for (const m of items) {
    const qid = titleToQid.get(m.wikipediaTitle);
    const coords = qid ? qidToCoord.get(qid) : null;
    if (coords) {
      results.push({
        code: m.municipalityCode,
        name: m.municipalityName,
        nameKana: metadataByCode.get(m.municipalityCode)?.kana || null,
        prefecture: m.prefectureName,
        type: metadataByCode.get(m.municipalityCode)?.type || null,
        parentMunicipality: metadataByCode.get(m.municipalityCode)?.parentMunicipality || null,
        lat: coords.lat,
        lng: coords.lng,
      });
    } else {
      process.stderr.write(`座標なし: ${m.municipalityName}\n`);
      missing++;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  console.log(`\n完了: ${results.length}/${items.length} 件 (未取得: ${missing} 件)`);
  console.log(`出力: ${OUTPUT}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
