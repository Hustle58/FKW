/*
 * Haze Tracker – shared core.
 * Loaded by the page (<script>) and by the service worker (importScripts),
 * so everything here must work in both. Settings live in IndexedDB because
 * service workers cannot read localStorage.
 */
(function (root) {
  'use strict';

  var API = 'https://api-open.data.gov.sg/v2/real-time/api';
  var PSI_URL = API + '/psi';
  var PM25_URL = API + '/pm25';

  var REGIONS = ['national', 'central', 'north', 'south', 'east', 'west'];
  var REGION_LABELS = {
    national: 'Singapore (overall)',
    central: 'Central',
    north: 'North',
    south: 'South',
    east: 'East',
    west: 'West',
  };

  // NEA 24-hr PSI descriptors
  function psiBand(v) {
    if (v == null || isNaN(v)) return { id: 'na', label: 'No data' };
    if (v <= 50) return { id: 'good', label: 'Good' };
    if (v <= 100) return { id: 'moderate', label: 'Moderate' };
    if (v <= 200) return { id: 'unhealthy', label: 'Unhealthy' };
    if (v <= 300) return { id: 'very-unhealthy', label: 'Very unhealthy' };
    return { id: 'hazardous', label: 'Hazardous' };
  }

  // NEA 1-hr PM2.5 bands (µg/m³)
  function pm25Band(v) {
    if (v == null || isNaN(v)) return { id: 'na', label: 'No data' };
    if (v <= 55) return { id: 'good', label: 'Normal' };
    if (v <= 150) return { id: 'unhealthy', label: 'Elevated' };
    if (v <= 250) return { id: 'very-unhealthy', label: 'High' };
    return { id: 'hazardous', label: 'Very high' };
  }

  /* ---------- tiny IndexedDB key/value store ---------- */
  var DB_NAME = 'haze-tracker';
  var STORE = 'kv';
  var dbPromise;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function kvGet(key) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var r = d.transaction(STORE).objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function kvSet(key, value) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var DEFAULT_SETTINGS = { enabled: false, region: 'national', threshold: 100, apiKey: '' };

  function getSettings() {
    return kvGet('settings').then(function (s) {
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    });
  }

  function saveSettings(s) {
    return kvSet('settings', s);
  }

  /* ---------- NEA data ---------- */
  function fetchJson(url, apiKey) {
    var headers = {};
    if (apiKey) headers['x-api-key'] = apiKey; // only sent when the user supplies a key
    return fetch(url, { headers: headers, cache: 'no-store' }).then(function (res) {
      if (res.status === 429) throw new Error('NEA rate limit reached – try again in a minute');
      if (!res.ok) throw new Error('NEA API returned HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (json && json.code !== undefined && json.code !== 0) {
        throw new Error(json.errorMsg || 'NEA API error');
      }
      return json && json.data !== undefined ? json.data : json;
    });
  }

  // Newest item in an { items: [...] } payload, plus its readings.
  function latestItem(data) {
    var items = (data && data.items) || [];
    var best = null;
    items.forEach(function (it) {
      if (!best || String(it.timestamp) > String(best.timestamp)) best = it;
    });
    return best;
  }

  function pickReadings(item, key) {
    var r = item && item.readings && item.readings[key];
    var out = {};
    REGIONS.forEach(function (region) {
      var v = r && r[region];
      out[region] = typeof v === 'number' ? v : null;
    });
    return out;
  }

  // Returns { timestamp, psi24: {region: n}, pm25h1: {region: n}, fetchedAt }
  function fetchSnapshot(apiKey) {
    return Promise.all([
      fetchJson(PSI_URL, apiKey),
      fetchJson(PM25_URL, apiKey).catch(function () { return null; }), // 1-hr PM2.5 is best-effort
    ]).then(function (res) {
      var psiItem = latestItem(res[0]);
      if (!psiItem) throw new Error('NEA returned no PSI readings');
      var pmItem = res[1] ? latestItem(res[1]) : null;
      return {
        timestamp: psiItem.timestamp,
        pm25Timestamp: pmItem ? pmItem.timestamp : null,
        psi24: pickReadings(psiItem, 'psi_twenty_four_hourly'),
        pm25h1: pickReadings(pmItem, 'pm25_one_hourly'),
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  /* ---------- threshold alerts ---------- */
  // Notify when the chosen region's 24-hr PSI is at/above the threshold, once per
  // crossing. The flag re-arms when the value drops back below the threshold.
  function evaluate(settings, snapshot, alerted) {
    var value = snapshot.psi24[settings.region];
    if (value == null) return { notify: false, alerted: alerted, value: value };
    var above = value >= settings.threshold;
    if (above && !alerted) return { notify: true, alerted: true, value: value };
    if (!above) return { notify: false, alerted: false, value: value };
    return { notify: false, alerted: alerted, value: value };
  }

  function showAlert(registration, settings, value) {
    var band = psiBand(value);
    var place = REGION_LABELS[settings.region];
    return registration.showNotification('Haze alert: PSI ' + value + ' (' + band.label + ')', {
      body: place + ' 24-hr PSI is ' + value + ', at or above your threshold of ' + settings.threshold + '.',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'psi-threshold',
      renotify: true,
      data: { url: './' },
    });
  }

  // Fetch, store the snapshot, and notify if the threshold was crossed.
  // Used by the page (foreground polling) and by the service worker (periodic sync).
  function checkAndNotify(registration) {
    return getSettings().then(function (settings) {
      return fetchSnapshot(settings.apiKey).then(function (snapshot) {
        return kvSet('snapshot', snapshot).then(function () {
          if (!settings.enabled) return { snapshot: snapshot, notified: false };
          return kvGet('alerted').then(function (alerted) {
            var result = evaluate(settings, snapshot, !!alerted);
            if (!result.notify) {
              return kvSet('alerted', result.alerted).then(function () {
                return { snapshot: snapshot, notified: false };
              });
            }
            // Only mark as alerted once the notification was really shown, so a failure retries next check.
            if (!registration || (root.Notification && root.Notification.permission !== 'granted')) {
              return { snapshot: snapshot, notified: false };
            }
            return showAlert(registration, settings, result.value)
              .then(function () { return kvSet('alerted', true); })
              .then(function () { return { snapshot: snapshot, notified: true }; });
          });
        });
      });
    });
  }

  root.HazeCore = {
    REGIONS: REGIONS,
    REGION_LABELS: REGION_LABELS,
    psiBand: psiBand,
    pm25Band: pm25Band,
    getSettings: getSettings,
    saveSettings: saveSettings,
    resetAlertState: function () { return kvSet('alerted', false); },
    getSnapshot: function () { return kvGet('snapshot'); },
    fetchSnapshot: fetchSnapshot,
    checkAndNotify: checkAndNotify,
    evaluate: evaluate,
    showAlert: showAlert,
  };
})(typeof self !== 'undefined' ? self : this);
