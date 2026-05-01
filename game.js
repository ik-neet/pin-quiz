'use strict';

const JAPAN_CENTER = [36.5, 136.0];
const JAPAN_ZOOM = 5;
const SCORE_BREAKS = [
  [20, 9], [50, 8], [100, 7],
  [200, 5], [400, 3], [700, 1], [Infinity, 0],
];

let municipalities = [];
let queue = [];
let map, guessMarker, answerMarker, connLine;
let round = 0, totalScore = 0, answered = false, current = null;
let pendingLat = null, pendingLng = null;
let boundaryIndex = null;
let highlightLayer = null;
let duplicateNames = new Set();

let settings = { rounds: 5, showPrefecture: 'auto', timeLimit: 0 };
let timerInterval = null, timeLeft = 0;

const el = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMunicipalityName(name, kana) {
  const safeName = escapeHtml(name);
  const safeKana = escapeHtml(kana);
  if (!safeKana) {
    return safeName;
  }
  return `<span class="name-stack"><span class="name-main">${safeName}</span><span class="name-ruby">${safeKana}</span></span>`;
}

function formatAnswerLabel(prefecture, name, kana) {
  return `正解：${escapeHtml(prefecture)} ${formatMunicipalityName(name, kana)}`;
}

function init() {
  initMap();
  loadBoundaryData();

  fetch('./data/municipalities.json')
    .then(r => r.json())
    .then(data => {
      municipalities = data;
      const counts = {};
      for (const m of municipalities) counts[m.name] = (counts[m.name] || 0) + 1;
      duplicateNames = new Set(Object.keys(counts).filter(n => counts[n] > 1));
      el('start-btn').disabled = false;
      el('start-btn').textContent = 'ゲームスタート →';
    })
    .catch(() => {
      el('start-btn').textContent = '読み込み失敗';
    });

  el('start-btn').addEventListener('click', onStartGame);
}

function onStartGame() {
  settings.rounds = Math.max(1, Math.min(50, parseInt(el('setting-rounds').value) || 5));
  settings.showPrefecture = el('setting-prefecture').value;
  settings.timeLimit = Math.max(0, parseInt(el('setting-timelimit').value) || 0);

  el('start-screen').classList.add('hidden');
  startNewGame();
}

async function loadBoundaryData() {
  try {
    const geojson = await fetch('./data/municipality-borders.geojson').then(r => r.json());
    boundaryIndex = {};
    for (const f of geojson.features) {
      const name = f.properties.NL_NAME_2 || f.properties.NAME_2;
      if (name) boundaryIndex[name] = f;
    }
  } catch {
    // 境界データなし → 距離スコアのみで動作
  }
}

function initMap() {
  map = L.map('map', {
    center: JAPAN_CENTER,
    zoom: JAPAN_ZOOM,
    minZoom: JAPAN_ZOOM,
    maxBounds: [[22, 120], [47, 150]],
    maxBoundsViscosity: 1.0,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/positron_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  map.createPane('municipalityPane');
  map.getPane('municipalityPane').style.zIndex = 420;
  map.createPane('prefecturePane');
  map.getPane('prefecturePane').style.zIndex = 430;
  map.createPane('highlightPane');
  map.getPane('highlightPane').style.zIndex = 450;
  map.getPane('municipalityPane').style.pointerEvents = 'none';
  map.getPane('prefecturePane').style.pointerEvents = 'none';
  map.getPane('highlightPane').style.pointerEvents = 'none';

  map.on('click', onMapClick);
  el('confirm-btn').addEventListener('click', onConfirm);
  addJapanMask();
  addMunicipalityBorders();
  addPrefectureBorders();
}

async function addMunicipalityBorders() {
  try {
    const geojson = await fetch('./data/municipality-borders.geojson').then(r => r.json());
    L.geoJSON(geojson, {
      style: { color: '#8899bb', weight: 0.5, opacity: 0.5, fillOpacity: 0, interactive: false },
      pane: 'municipalityPane',
    }).addTo(map);
  } catch {
    // 境界データなしの場合はそのまま続行
  }
}

async function addPrefectureBorders() {
  try {
    const geojson = await fetch('https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson').then(r => r.json());
    L.geoJSON(geojson, {
      style: { color: '#1a1a2e', weight: 1.2, opacity: 0.7, fillOpacity: 0, interactive: false },
      pane: 'prefecturePane',
    }).addTo(map);
  } catch {
    // 境界線取得失敗時はそのまま続行
  }
}

async function addJapanMask() {
  try {
    const geojson = await fetch('https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson').then(r => r.json());

    const japanRings = [];
    for (const feature of geojson.features) {
      const geom = feature.geometry;
      if (geom.type === 'Polygon') {
        japanRings.push(geom.coordinates[0].slice().reverse());
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          japanRings.push(poly[0].slice().reverse());
        }
      }
    }

    const world = [[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]];
    L.geoJSON({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [world, ...japanRings] },
    }, {
      style: { fillColor: '#666', fillOpacity: 0.45, weight: 0, interactive: false },
    }).addTo(map);
  } catch {
    // マスク取得失敗時はそのまま続行
  }
}

function startNewGame() {
  round = 0;
  totalScore = 0;
  answered = false;
  queue = shuffle([...municipalities]).slice(0, settings.rounds);

  el('total-rounds').textContent = settings.rounds;
  el('total-score').textContent = '0';
  el('game-over').classList.add('hidden');

  startRound();
}

function startRound() {
  round++;
  answered = false;
  current = queue[round - 1];

  [guessMarker, answerMarker, connLine, highlightLayer].forEach(l => l && map.removeLayer(l));
  guessMarker = answerMarker = connLine = highlightLayer = null;

  el('current-round').textContent = round;
  el('municipality-name').innerHTML = formatMunicipalityName(current.name, current.nameKana);

  const alwaysShow = settings.showPrefecture === 'always';
  el('prefecture-hint').textContent = (alwaysShow || duplicateNames.has(current.name)) ? current.prefecture : '';

  pendingLat = pendingLng = null;
  el('result-panel').classList.add('hidden');
  el('confirm-btn').classList.add('hidden');
  el('instruction').textContent = '地図をクリックしてピンを刺してください';

  map.setView(JAPAN_CENTER, JAPAN_ZOOM, { animate: true });

  clearTimer();
  if (settings.timeLimit > 0) startTimer(settings.timeLimit);
}

function startTimer(seconds) {
  timeLeft = seconds;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearTimer();
      onTimerExpired();
    }
  }, 1000);
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  el('timer').textContent = '';
  el('timer').removeAttribute('data-urgent');
}

function updateTimerDisplay() {
  el('timer').textContent = `残り ${timeLeft} 秒`;
  el('timer').dataset.urgent = timeLeft <= 5 ? 'true' : 'false';
}

function onTimerExpired() {
  if (answered) return;
  if (pendingLat !== null) {
    revealResult(pendingLat, pendingLng);
  } else {
    revealResult(null, null);
  }
}

function onMapClick(e) {
  if (answered) return;

  const { lat, lng } = e.latlng;
  pendingLat = lat;
  pendingLng = lng;

  if (guessMarker) map.removeLayer(guessMarker);
  guessMarker = L.marker([lat, lng], { icon: pinIcon('pin-guess') }).addTo(map);

  el('confirm-btn').classList.remove('hidden');
  el('instruction').textContent = 'ピンを動かせます。よければ「ここに決定！」を押してください';
}

function onConfirm() {
  if (answered || pendingLat === null) return;
  el('confirm-btn').classList.add('hidden');
  clearTimer();
  revealResult(pendingLat, pendingLng);
}

function revealResult(guessLat, guessLng) {
  answered = true;
  clearTimer();

  const isTimeout = guessLat === null;
  let dist = 0, pts = 0, inBoundary = false;

  if (!isTimeout) {
    dist = haversine(guessLat, guessLng, current.lat, current.lng);
    ({ pts, inBoundary } = calcPoints(dist, guessLat, guessLng));
  }

  totalScore += pts;

  if (isTimeout) {
    el('result-guess').textContent = '時間切れ';
  } else {
    const guessedName = findMunicipalityAt(guessLng, guessLat);
    el('result-guess').textContent = guessedName ? `選択：${guessedName}` : '選択：（市区町村外）';
  }

  if (boundaryIndex) {
    const feature = boundaryIndex[current.name];
    if (feature) {
      highlightLayer = L.geoJSON(feature, {
        style: { color: '#27ae60', weight: 2.5, opacity: 0.9, fillColor: '#27ae60', fillOpacity: 0.25, interactive: false },
        pane: 'highlightPane',
      }).addTo(map);
    }
  }

  answerMarker = L.marker([current.lat, current.lng], { icon: pinIcon('pin-answer') })
    .addTo(map)
    .bindPopup(`<b>${escapeHtml(current.prefecture)}</b><br>${formatMunicipalityName(current.name, current.nameKana)}`)
    .openPopup();

  if (!isTimeout && !inBoundary) {
    connLine = L.polyline(
      [[guessLat, guessLng], [current.lat, current.lng]],
      { color: '#e74c3c', weight: 2, dashArray: '6,8', opacity: 0.75 }
    ).addTo(map);
  }

  if (!isTimeout) {
    const bounds = L.latLngBounds([[guessLat, guessLng], [current.lat, current.lng]]);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 10 });
  } else {
    map.setView([current.lat, current.lng], 9, { animate: true });
  }

  el('total-score').textContent = totalScore;

  if (isTimeout) {
    el('result-distance').textContent = '時間切れ';
  } else if (inBoundary) {
    el('result-distance').textContent = '境界内！';
  } else {
    const distLabel = dist < 1
      ? `${Math.round(dist * 1000)} m`
      : `${Math.round(dist).toLocaleString()} km`;
    el('result-distance').textContent = `距離：${distLabel}`;
  }

  el('result-label').innerHTML = formatAnswerLabel(current.prefecture, current.name, current.nameKana);
  el('result-points').textContent = `+${pts}`;
  el('result-points').dataset.level = pts >= 8 ? 'high' : pts >= 5 ? 'mid' : pts >= 1 ? 'low' : 'zero';

  const isLast = round >= settings.rounds;
  el('next-btn').textContent = isLast ? '結果を見る →' : '次の問題へ →';
  el('next-btn').onclick = isLast ? showGameOver : startRound;

  el('result-panel').classList.remove('hidden');
  el('instruction').innerHTML = formatAnswerLabel(current.prefecture, current.name, current.nameKana);
}

function showGameOver() {
  el('result-panel').classList.add('hidden');

  const max = settings.rounds * 10;
  const pct = Math.round(totalScore / max * 100);
  const msgs = [
    [90, '地理マスター！🏆'],
    [70, 'なかなかの腕前！'],
    [50, 'まあまあ！'],
    [0,  '要練習！'],
  ];
  const msg = msgs.find(([threshold]) => pct >= threshold)[1];

  el('final-msg').textContent = msg;
  el('final-score').textContent = `${totalScore} / ${max}`;
  el('final-pct').textContent = `正答率 ${pct}%`;
  el('restart-btn').onclick = startNewGame;
  el('game-over').classList.remove('hidden');
}

function calcPoints(distKm, guessLat, guessLng) {
  if (boundaryIndex && current) {
    const feature = boundaryIndex[current.name];
    if (feature && pointInFeature([guessLng, guessLat], feature)) {
      return { pts: 10, inBoundary: true };
    }
  }
  for (const [maxDist, pts] of SCORE_BREAKS) {
    if (distKm <= maxDist) return { pts, inBoundary: false };
  }
  return { pts: 0, inBoundary: false };
}

function findMunicipalityAt(lng, lat) {
  if (!boundaryIndex) return null;
  for (const [name, feature] of Object.entries(boundaryIndex)) {
    if (pointInFeature([lng, lat], feature)) return name;
  }
  return null;
}

function pointInFeature(point, feature) {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    return pointInPolygon(point, geom.coordinates);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => pointInPolygon(point, poly));
  }
  return false;
}

function pointInPolygon(point, rings) {
  if (!raycast(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (raycast(point, rings[i])) return false;
  }
  return true;
}

function raycast(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pinIcon(className) {
  return L.divIcon({
    className: '',
    html: `<div class="${className}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -22],
  });
}

document.addEventListener('DOMContentLoaded', init);
