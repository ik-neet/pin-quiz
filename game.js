'use strict';

const JAPAN_CENTER = [36.5, 136.0];
const JAPAN_ZOOM = 5;
const SCORE_BREAKS = [
  [20, 9], [50, 8], [100, 7],
  [200, 5], [400, 3], [700, 1], [Infinity, 0],
];

let municipalities = [];
let queue = [];
let map;
let guessMarker;
let answerMarker;
let connLine;
let round = 0;
let totalScore = 0;
let answered = false;
let current = null;
let pendingLat = null;
let pendingLng = null;
let boundaryIndex = null;
let highlightLayer = null;
let duplicateNames = new Set();

let settings = {
  rounds: 5,
  showPrefecture: 'auto',
  timeLimit: 0,
  showKana: true,
};

let timerInterval = null;
let timeLeft = 0;

const el = id => document.getElementById(id);
const DIFFICULTY_PRESETS = {
  beginner: {
    showPrefecture: 'always',
    timeLimit: 0,
    showKana: true,
  },
  intermediate: {
    showPrefecture: 'auto',
    timeLimit: 30,
    showKana: true,
  },
  advanced: {
    showPrefecture: 'auto',
    timeLimit: 15,
    showKana: false,
  },
};
const EXCLUDED_MUNICIPALITY_CODES = new Set([
  '01101', '01102', '01103', '01104', '01105', '01106', '01107', '01108', '01109', '01110',
  '04101', '04102', '04103', '04104', '04105',
  '11101', '11102', '11103', '11104', '11105', '11106', '11107', '11108', '11109', '11110',
  '12101', '12102', '12103', '12104', '12105', '12106',
  '14101', '14102', '14103', '14104', '14105', '14106', '14107', '14108', '14109', '14110',
  '14111', '14112', '14113', '14114', '14115', '14116', '14117', '14118',
  '14131', '14132', '14133', '14134', '14135', '14136', '14137',
  '14151', '14152', '14153',
  '15101', '15102', '15103', '15104', '15105', '15106', '15107', '15108',
  '22101', '22102', '22103', '22138', '22139', '22140',
  '23101', '23102', '23103', '23104', '23105', '23106', '23107', '23108', '23109', '23110',
  '23111', '23112', '23113', '23114', '23115', '23116',
  '26101', '26102', '26103', '26104', '26105', '26106', '26107', '26108', '26109', '26110', '26111',
  '27102', '27103', '27104', '27106', '27107', '27108', '27109', '27111', '27113', '27114',
  '27115', '27116', '27117', '27118', '27119', '27120', '27121', '27122', '27123', '27124',
  '27125', '27126', '27127', '27128',
  '27141', '27142', '27143', '27144', '27145', '27146', '27147',
  '28101', '28102', '28105', '28106', '28107', '28108', '28109', '28110', '28111',
  '33101', '33102', '33103', '33104',
  '34101', '34102', '34103', '34104', '34105', '34106', '34107', '34108',
  '40101', '40103', '40105', '40106', '40107', '40108', '40109',
  '40131', '40132', '40133', '40134', '40135', '40136', '40137',
  '43101', '43102', '43103', '43104', '43105',
]);

function isPlayableMunicipality(municipality) {
  return !EXCLUDED_MUNICIPALITY_CODES.has(municipality.code);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMunicipalityName(name, kana, showKana = settings.showKana) {
  const safeName = escapeHtml(name);
  const safeKana = escapeHtml(kana);
  if (!showKana || !safeKana) {
    return safeName;
  }
  return `<span class="name-stack"><span class="name-main">${safeName}</span><span class="name-ruby">${safeKana}</span></span>`;
}

function formatAnswerLabel(prefecture, name, kana, showKana = settings.showKana) {
  return `正解: ${escapeHtml(prefecture)} ${formatMunicipalityName(name, kana, showKana)}`;
}

function setDifficultySelection(difficulty) {
  document.querySelectorAll('.difficulty-btn').forEach(button => {
    button.classList.toggle('is-active', button.dataset.difficulty === difficulty);
  });

  const note = el('difficulty-note');
  note.textContent = difficulty === 'custom'
    ? '現在はカスタム設定です'
    : '個別に変更するとカスタム設定になります';
}

function updateRangeDisplays() {
  const rounds = Math.max(1, parseInt(el('setting-rounds').value, 10) || 5);
  const timeLimit = Math.max(0, Math.min(120, parseInt(el('setting-timelimit').value, 10) || 0));
  el('setting-rounds-value').textContent = `${rounds}問`;
  el('setting-timelimit-value').textContent = timeLimit > 0 ? `${timeLimit}秒` : 'なし';
}

function applyDifficultyPreset(difficulty) {
  const preset = DIFFICULTY_PRESETS[difficulty];
  if (!preset) {
    return;
  }

  el('setting-prefecture').value = preset.showPrefecture;
  el('setting-timelimit').value = String(preset.timeLimit);
  el('setting-kana').value = preset.showKana ? 'on' : 'off';
  updateRangeDisplays();
  setDifficultySelection(difficulty);
}

function syncDifficultySelection() {
  const currentConfig = {
    showPrefecture: el('setting-prefecture').value,
    timeLimit: Math.max(0, Math.min(120, parseInt(el('setting-timelimit').value, 10) || 0)),
    showKana: el('setting-kana').value === 'on',
  };

  const matchedDifficulty = Object.entries(DIFFICULTY_PRESETS).find(([, preset]) =>
    preset.showPrefecture === currentConfig.showPrefecture
    && preset.timeLimit === currentConfig.timeLimit
    && preset.showKana === currentConfig.showKana
  );

  updateRangeDisplays();
  setDifficultySelection(matchedDifficulty ? matchedDifficulty[0] : 'custom');
}

function init() {
  initMap();
  loadBoundaryData();
  applyDifficultyPreset('beginner');

  fetch('./data/municipalities.json')
    .then(response => response.json())
    .then(data => {
      municipalities = data.filter(isPlayableMunicipality);
      const counts = {};
      for (const municipality of municipalities) {
        counts[municipality.name] = (counts[municipality.name] || 0) + 1;
      }
      duplicateNames = new Set(Object.keys(counts).filter(name => counts[name] > 1));
      el('start-btn').disabled = false;
      el('start-btn').textContent = 'ゲームスタート';
    })
    .catch(() => {
      el('start-btn').textContent = '読み込み失敗';
    });

  el('start-btn').addEventListener('click', onStartGame);
  document.querySelectorAll('.difficulty-btn').forEach(button => {
    button.addEventListener('click', () => {
      applyDifficultyPreset(button.dataset.difficulty);
    });
  });
  ['setting-rounds', 'setting-timelimit'].forEach(id => {
    el(id).addEventListener('input', updateRangeDisplays);
  });
  ['setting-prefecture', 'setting-timelimit', 'setting-kana'].forEach(id => {
    ['input', 'change'].forEach(eventName => {
      el(id).addEventListener(eventName, syncDifficultySelection);
    });
  });
  updateRangeDisplays();
  syncDifficultySelection();
}

function onStartGame() {
  settings.rounds = Math.max(1, Math.min(30, parseInt(el('setting-rounds').value, 10) || 5));
  settings.showPrefecture = el('setting-prefecture').value;
  settings.timeLimit = Math.max(0, Math.min(120, parseInt(el('setting-timelimit').value, 10) || 0));
  settings.showKana = el('setting-kana').value === 'on';

  el('start-screen').classList.add('hidden');
  startNewGame();
}

async function loadBoundaryData() {
  try {
    const geojson = await fetch('./data/municipality-borders.geojson').then(response => response.json());
    boundaryIndex = {};
    for (const feature of geojson.features) {
      const name = feature.properties.NL_NAME_2 || feature.properties.NAME_2;
      if (name) {
        boundaryIndex[name] = feature;
      }
    }
  } catch {
    // 境界データがなくても距離ベースの採点で続行する。
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
    const geojson = await fetch('./data/municipality-borders.geojson').then(response => response.json());
    L.geoJSON(geojson, {
      style: {
        color: '#8899bb',
        weight: 0.5,
        opacity: 0.5,
        fillOpacity: 0,
        interactive: false,
      },
      pane: 'municipalityPane',
    }).addTo(map);
  } catch {
    // 境界線なしでもプレイ可能。
  }
}

async function addPrefectureBorders() {
  try {
    const geojson = await fetch('https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson').then(response => response.json());
    L.geoJSON(geojson, {
      style: {
        color: '#1a1a2e',
        weight: 1.2,
        opacity: 0.7,
        fillOpacity: 0,
        interactive: false,
      },
      pane: 'prefecturePane',
    }).addTo(map);
  } catch {
    // 都道府県境界の取得失敗時はそのまま続行する。
  }
}

async function addJapanMask() {
  try {
    const geojson = await fetch('https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson').then(response => response.json());
    const japanRings = [];

    for (const feature of geojson.features) {
      const geometry = feature.geometry;
      if (geometry.type === 'Polygon') {
        japanRings.push(geometry.coordinates[0].slice().reverse());
      } else if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) {
          japanRings.push(polygon[0].slice().reverse());
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
    // マスクがなくてもプレイ可能。
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
  round += 1;
  answered = false;
  current = queue[round - 1];

  [guessMarker, answerMarker, connLine, highlightLayer].forEach(layer => layer && map.removeLayer(layer));
  guessMarker = null;
  answerMarker = null;
  connLine = null;
  highlightLayer = null;

  el('current-round').textContent = round;
  el('municipality-name').innerHTML = formatMunicipalityName(current.name, current.nameKana);

  const alwaysShow = settings.showPrefecture === 'always';
  el('prefecture-hint').textContent = (alwaysShow || duplicateNames.has(current.name)) ? current.prefecture : '';

  pendingLat = null;
  pendingLng = null;
  el('result-panel').classList.add('hidden');
  el('confirm-btn').classList.add('hidden');
  el('instruction').textContent = '地図をクリックしてピンを置いてください';

  map.setView(JAPAN_CENTER, JAPAN_ZOOM, { animate: true });

  clearTimer();
  if (settings.timeLimit > 0) {
    startTimer(settings.timeLimit);
  }
}

function startTimer(seconds) {
  timeLeft = seconds;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft -= 1;
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
  if (answered) {
    return;
  }
  if (pendingLat !== null) {
    revealResult(pendingLat, pendingLng);
  } else {
    revealResult(null, null);
  }
}

function onMapClick(event) {
  if (answered) {
    return;
  }

  const { lat, lng } = event.latlng;
  pendingLat = lat;
  pendingLng = lng;

  if (guessMarker) {
    map.removeLayer(guessMarker);
  }
  guessMarker = L.marker([lat, lng], { icon: pinIcon('pin-guess') }).addTo(map);

  el('confirm-btn').classList.remove('hidden');
  el('instruction').textContent = 'ピンを動かせます。よければ「ここに決定」を押してください';
}

function onConfirm() {
  if (answered || pendingLat === null) {
    return;
  }
  el('confirm-btn').classList.add('hidden');
  clearTimer();
  revealResult(pendingLat, pendingLng);
}

function revealResult(guessLat, guessLng) {
  answered = true;
  clearTimer();

  const isTimeout = guessLat === null;
  let dist = 0;
  let pts = 0;
  let inBoundary = false;

  if (!isTimeout) {
    dist = haversine(guessLat, guessLng, current.lat, current.lng);
    ({ pts, inBoundary } = calcPoints(dist, guessLat, guessLng));
  }

  totalScore += pts;

  if (isTimeout) {
    el('result-guess').textContent = '時間切れ';
  } else {
    const guessedName = findMunicipalityAt(guessLng, guessLat);
    el('result-guess').textContent = guessedName ? `選択地点: ${guessedName}` : '選択地点: 市町村境界の外';
  }

  if (boundaryIndex) {
    const feature = boundaryIndex[current.name];
    if (feature) {
      highlightLayer = L.geoJSON(feature, {
        style: {
          color: '#27ae60',
          weight: 2.5,
          opacity: 0.9,
          fillColor: '#27ae60',
          fillOpacity: 0.25,
          interactive: false,
        },
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
    el('result-distance').textContent = '市町村内ヒット';
  } else {
    const distLabel = dist < 1
      ? `${Math.round(dist * 1000)} m`
      : `${Math.round(dist).toLocaleString()} km`;
    el('result-distance').textContent = `距離: ${distLabel}`;
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
  const pct = Math.round((totalScore / max) * 100);
  const messages = [
    [90, '地理マスター！'],
    [70, 'かなり詳しいです'],
    [50, 'まずまずです'],
    [0, '伸びしろたっぷり'],
  ];
  const message = messages.find(([threshold]) => pct >= threshold)[1];

  el('final-msg').textContent = message;
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
    if (distKm <= maxDist) {
      return { pts, inBoundary: false };
    }
  }

  return { pts: 0, inBoundary: false };
}

function findMunicipalityAt(lng, lat) {
  if (!boundaryIndex) {
    return null;
  }
  for (const [name, feature] of Object.entries(boundaryIndex)) {
    if (pointInFeature([lng, lat], feature)) {
      const prefecture = feature.properties.NL_NAME_1 || feature.properties.NAME_1 || '';
      return prefecture ? `${prefecture} ${name}` : name;
    }
  }
  return null;
}

function pointInFeature(point, feature) {
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygon(point, polygon));
  }
  return false;
}

function pointInPolygon(point, rings) {
  if (!raycast(point, rings[0])) {
    return false;
  }
  for (let i = 1; i < rings.length; i += 1) {
    if (raycast(point, rings[i])) {
      return false;
    }
  }
  return true;
}

function raycast(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function haversine(lat1, lng1, lat2, lng2) {
  const radiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.asin(Math.sqrt(a));
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
