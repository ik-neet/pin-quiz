'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '../data/water-bodies.geojson');
const WATER_BODIES = [
  { id: 'lake-biwa', name: '琵琶湖', query: 'Lake Biwa, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-kasumigaura', name: '霞ヶ浦', query: 'Lake Kasumigaura, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-saroma', name: 'サロマ湖', query: 'Lake Saroma, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-jusan', name: '十三湖', query: '十三湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-inawashiro', name: '猪苗代湖', query: 'Lake Inawashiro, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-nakaumi', name: '中海', query: 'Nakaumi, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-shinji', name: '宍道湖', query: 'Lake Shinji, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-hamana', name: '浜名湖', query: 'Lake Hamana, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-furen', name: '風蓮湖', query: '風蓮湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-ogawara', name: '小川原湖', query: '小川原湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-towada', name: '十和田湖', query: '十和田湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-notoro', name: '能取湖', query: '能取湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-kitaura', name: '北浦', query: 'Lake Kitaura, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-akkeshi', name: '厚岸湖', query: '厚岸湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-abashiri', name: '網走湖', query: '網走湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-hachirogata', name: '八郎潟調整池', query: '八郎潟調整池, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-tazawa', name: '田沢湖', query: '田沢湖, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-kussharo', name: '屈斜路湖', query: 'Lake Kussharo, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-shikotsu', name: '支笏湖', query: 'Lake Shikotsu, Japan', kind: 'lake', defaultVisible: true },
  { id: 'lake-toya', name: '洞爺湖', query: 'Lake Toya, Japan', kind: 'lake', defaultVisible: true },
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'pin-quiz/1.0 (educational)',
        'Accept': 'application/geo+json, application/json',
      },
    };
    https.get(url, options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function buildSearchUrl(query) {
  const params = new URLSearchParams({
    format: 'geojson',
    polygon_geojson: '1',
    limit: '5',
    q: query,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

function selectFeature(features) {
  return (features || []).find(feature =>
    feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon'
  ) || null;
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const features = [];

  for (const waterBody of WATER_BODIES) {
    console.log(`取得中: ${waterBody.name}`);
    const result = await fetchJson(buildSearchUrl(waterBody.query));
    const feature = selectFeature(result.features);
    if (!feature) {
      throw new Error(`${waterBody.name} のポリゴンを取得できませんでした`);
    }

    features.push({
      type: 'Feature',
      properties: {
        id: waterBody.id,
        name: waterBody.name,
        kind: waterBody.kind,
        defaultVisible: waterBody.defaultVisible,
        source: 'OpenStreetMap Nominatim',
        osmType: feature.properties?.osm_type || null,
        osmId: feature.properties?.osm_id || null,
        query: waterBody.query,
      },
      geometry: feature.geometry,
    });
  }

  fs.writeFileSync(OUTPUT, JSON.stringify({
    type: 'FeatureCollection',
    features,
  }));
  console.log(`完了: ${OUTPUT}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
