'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const DOWNLOAD_URL = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_JPN_1.json';
const OUTPUT = path.join(__dirname, '../data/prefecture-borders.geojson');

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
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        const mb = (received / 1024 / 1024).toFixed(1);
        const pct = total ? ` (${Math.round(received / total * 100)}%)` : '';
        process.stdout.write(`\r  ${mb} MB${pct}   `);
      });
      res.pipe(file);
      file.on('finish', () => {
        process.stdout.write('\n');
        file.close(resolve);
      });
    }).on('error', (error) => {
      fs.unlink(outputPath, () => {});
      reject(error);
    });
  });
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  console.log('GADM Japan ADM1 (都道府県境界) をダウンロード中...');
  console.log(`  URL: ${DOWNLOAD_URL}`);
  await download(DOWNLOAD_URL, OUTPUT);
  const stat = fs.statSync(OUTPUT);
  console.log(`完了: ${OUTPUT} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
