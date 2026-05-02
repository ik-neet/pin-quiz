'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DOWNLOAD_URL = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_JPN_2.json';
const OUTPUT = path.join(__dirname, '../data/municipality-borders.geojson');
const BOUNDARY_NAME_FIXES = {
  '高知県::ShimantoCity': '四万十市',
};

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    const opts = { headers: { 'User-Agent': 'pin-quiz/1.0 (educational)' } };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => download(res.headers.location, outputPath).then(resolve, reject));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        const mb = (received / 1024 / 1024).toFixed(1);
        const pct = total ? ` (${Math.round(received / total * 100)}%)` : '';
        process.stdout.write(`\r  ${mb} MB${pct}   `);
      });
      res.pipe(file);
      file.on('finish', () => { process.stdout.write('\n'); file.close(resolve); });
    }).on('error', (e) => { fs.unlink(outputPath, () => {}); reject(e); });
  });
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  console.log('GADM Japan ADM2 (市区町村境界) をダウンロード中...');
  console.log(`  URL: ${DOWNLOAD_URL}`);
  await download(DOWNLOAD_URL, OUTPUT);
  const geojson = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  for (const feature of geojson.features || []) {
    const prefecture = feature.properties?.NL_NAME_1 || feature.properties?.NAME_1 || '';
    const romanizedName = feature.properties?.NAME_2 || '';
    const fixedName = BOUNDARY_NAME_FIXES[`${prefecture}::${romanizedName}`];
    if (fixedName) {
      feature.properties.NL_NAME_2 = fixedName;
    }
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(geojson));
  const stat = fs.statSync(OUTPUT);
  console.log(`完了: ${OUTPUT} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
