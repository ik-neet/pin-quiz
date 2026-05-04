'use strict';

const fs = require('fs');
const path = require('path');

const MUNICIPALITY_SUPPLEMENT_PATH = path.join(__dirname, '../data/municipality-boundary-supplements.geojson');

function readMunicipalityBoundarySupplements() {
  if (!fs.existsSync(MUNICIPALITY_SUPPLEMENT_PATH)) {
    return [];
  }

  const geojson = JSON.parse(fs.readFileSync(MUNICIPALITY_SUPPLEMENT_PATH, 'utf8'));
  return geojson.features || [];
}

function getMunicipalityKey(feature) {
  const properties = feature?.properties || {};
  const prefecture = properties.NL_NAME_1 || properties.NAME_1 || '';
  const municipality = properties.NL_NAME_2 || properties.NAME_2 || '';
  return `${prefecture}::${municipality}`;
}

function mergeMunicipalitySupplements(geojson, supplements = readMunicipalityBoundarySupplements()) {
  const existingKeys = new Set((geojson.features || []).map(getMunicipalityKey));

  for (const supplement of supplements) {
    const key = getMunicipalityKey(supplement);
    if (!key || existingKeys.has(key)) {
      continue;
    }
    geojson.features.push(supplement);
    existingKeys.add(key);
  }

  return geojson;
}

function getPrefectureNames(feature) {
  const properties = feature?.properties || {};
  return new Set([
    properties.NL_NAME_1,
    properties.NAME_1,
  ].filter(Boolean));
}

function getRepresentativePoint(feature) {
  const properties = feature?.properties || {};
  if (Number.isFinite(properties.centerLng) && Number.isFinite(properties.centerLat)) {
    return [properties.centerLng, properties.centerLat];
  }

  const geometry = feature?.geometry;
  if (!geometry) {
    return null;
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates?.[0]?.[0] || null;
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates?.[0]?.[0]?.[0] || null;
  }

  return null;
}

function appendGeometry(baseGeometry, extraGeometry) {
  const basePolygons = baseGeometry.type === 'MultiPolygon'
    ? baseGeometry.coordinates
    : [baseGeometry.coordinates];
  const extraPolygons = extraGeometry.type === 'MultiPolygon'
    ? extraGeometry.coordinates
    : [extraGeometry.coordinates];

  return {
    type: 'MultiPolygon',
    coordinates: [...basePolygons, ...extraPolygons],
  };
}

function pointInFeature(point, feature) {
  const geometry = feature?.geometry;
  if (!geometry) {
    return false;
  }
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
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function mergePrefectureGeometryFromSupplements(geojson, supplements = readMunicipalityBoundarySupplements()) {
  for (const supplement of supplements) {
    const names = getPrefectureNames(supplement);
    if (!names.size) {
      continue;
    }

    const prefectureFeature = (geojson.features || []).find(feature => {
      const featureNames = getPrefectureNames(feature);
      return [...names].some(name => featureNames.has(name));
    });
    if (!prefectureFeature) {
      continue;
    }

    const representativePoint = getRepresentativePoint(supplement);
    if (representativePoint && pointInFeature(representativePoint, prefectureFeature)) {
      continue;
    }

    prefectureFeature.geometry = appendGeometry(prefectureFeature.geometry, supplement.geometry);
  }

  return geojson;
}

module.exports = {
  mergeMunicipalitySupplements,
  mergePrefectureGeometryFromSupplements,
  readMunicipalityBoundarySupplements,
};
