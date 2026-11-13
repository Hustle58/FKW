(function () {
  'use strict';

  var Core = window.HazeCore;
  var $ = function (id) { return document.getElementById(id); };
  var POLL_MS = 5 * 60 * 1000;

  var els = {
    updated: $('updated'),
    refresh: $('refresh'),
    error: $('error'),
    overall: $('overall'),
    regions: $('regions'),
    form: $('alert-form'),
    region: $('region'),
    threshold: $('threshold'),
    apikey: $('apikey'),
    save: $('save'),
    off: $('off'),
    test: $('test'),
    status: $('alert-status'),
    bgNote: $('bg-note'),
    install: $('install'),
    installText: $('install-text'),
    installBtn: $('install-btn'),
  };

  var swReg = null;
  var settings = null;
  var snapshot = null;

  /* ---------- rendering ---------- */
  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString('en-SG', {
        timeZone: 'Asia/Singapore', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch (e) { return iso; }
  }

  function num(v) { return v == null ? '–' : String(v); }

  function card(region, snap, opts) {
    var psi = snap ? snap.psi24[region] : null;
    var pm = snap ? snap.pm25h1[region] : null;
    var pb = Core.psiBand(psi);
    var mb = Core.pm25Band(pm);
    var watched = settings && settings.enabled && settings.region === region;

    var el = document.createElement('article');
    el.className = 'reading ' + pb.id + (opts && opts.big ? ' big' : '') + (watched ? ' watched' : '');
    if (watched) el.title = 'Alerts on for this region';
    el.innerHTML =
      '<h3></h3>' +
      '<div class="psi"><span class="num"></span><span class="pill"></span></div>' +
      '<p class="cap">24-hr PSI</p>' +
      '<p class="pm"><span>1-hr PM2.5 <b></b> µg/m³</span><span class="pill pm-pill"></span></p>';
    el.querySelector('h3').textContent = Core.REGION_LABELS[region];
    el.querySelector('.num').textContent = num(psi);
    el.querySelector('.pill').textContent = pb.label;
    el.querySelector('.pm b').textContent = num(pm);
    var pp = el.querySelector('.pm-pill');
    pp.textContent = mb.label;
    pp.className = 'pill pm-pill ' + mb.id;
    return el;
  }

  function render() {
    els.overall.replaceChildren(card('national', snapshot, { big: true }));
    els.regions.replaceChildren.apply(
      els.regions,
      ['central', 'north', 'south', 'east', 'west'].map(function (r) { return card(r, snapshot); })
    );
    if (snapshot) {
      els.updated.textContent = 'NEA reading ' + fmtTime(snapshot.timestamp);
    }
  }

  function showError(msg) {
    els.error.hidden = !msg;
    els.error.textContent = msg || '';
  }

  /* ---------- data ---------- */
  var busy = false;
  function refresh() {
    if (busy) return Promise.resolve();
    busy = true;
    els.refresh.classList.add('spin');
    return Core.checkAndNotify(swReg)
      .then(function (res) {
        snapshot = res.snapshot;
        showError('');
        if (res.notified) setStatus('Alert sent: PSI crossed your threshold.');
      })
      .catch(function (err) {
        var offline = !navigator.onLine;
        showError((offline ? 'You appear to be offline. ' : 'Could not load NEA data: ' + err.message + '. ') +
          (snapshot ? 'Showing the last saved reading.' : ''));
      })
      .then(function () {
        busy = false;
        els.refresh.classList.remove('spin');
        render();
      });
  }

  /* ---------- alerts ---------- */
  function setStatus(text) { els.status.textContent = text; }

  function notificationsSupported() { return 'Notification' in window && !!swReg; }

  function syncUi() {
    els.save.textContent = settings.enabled ? 'Update alert' : 'Turn on alerts';
    els.off.hidden = !settings.enabled;
    if (settings.enabled) {
      setStatus('Alerts on: ' + Core.REGION_LABELS[settings.region] + ' at PSI ' + settings.threshold + ' or above.');
    } else {
      setStatus('Alerts are off.');
    }
  }

  function describeBackground() {
    var hasPeriodic = swReg && 'periodicSync' in swReg;
    els.bgNote.textContent = hasPeriodic
      ? 'Heads-up: with the app installed, Chrome may also check in the background every so often, but the timing is up to the browser. Open the app now and then to be sure.'
      : 'Heads-up: there is no server behind this app, so alerts are checked while it is open or recently open, not continuously in the background.';
  }

  function registerBackgroundCheck() {
    if (!swReg || !('periodicSync' in swReg)) return Promise.resolve();
    return navigator.permissions.query({ name: 'periodic-background-sync' })
      .then(function (p) {
        if (p.state === 'granted') return swReg.periodicSync.register('psi-check', { minInterval: 60 * 60 * 1000 });
      })
      .catch(function () {});
  }

  function requestPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return Notification.requestPermission();
  }

  function permissionProblem(p) {
    if (p === 'unsupported' || !swReg) {
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      return ios
        ? 'Notifications on iPhone/iPad only work once the app is added to your Home Screen (iOS 16.4 or later). Add it, then open it from there.'
        : 'This browser does not support notifications for web apps.';
    }
    if (p === 'denied') return 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.';
    return '';
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var threshold = parseInt(els.threshold.value, 10);
    if (!(threshold >= 1 && threshold <= 500)) {
      setStatus('Enter a PSI threshold between 1 and 500.');
      return;
    }
    requestPermission().then(function (perm) {
      var problem = permissionProblem(perm);
      if (problem) { setStatus(problem); return; }
      if (perm !== 'granted') { setStatus('Notification permission was not granted.'); return; }
      settings = {
        enabled: true,
        region: els.region.value,
        threshold: threshold,
        apiKey: els.apikey.value.trim(),
      };
      return Core.saveSettings(settings)
        .then(Core.resetAlertState)
        .then(registerBackgroundCheck)
        .then(function () { syncUi(); return refresh(); });
    });
  });

  els.off.addEventListener('click', function () {
    settings.enabled = false;
    Core.saveSettings(settings).then(function () { syncUi(); render(); });
  });

  els.test.addEventListener('click', function () {
    requestPermission().then(function (perm) {
      var problem = permissionProblem(perm);
      if (problem) { setStatus(problem); return; }
      if (perm !== 'granted') { setStatus('Notification permission was not granted.'); return; }
      return swReg.showNotification('Haze Tracker test', {
        body: 'Notifications are working. You will get one like this when your PSI threshold is crossed.',
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: 'psi-test',
        data: { url: './' },
      }).then(function () { setStatus('Test notification sent.'); });
    });
  });

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () { els.threshold.value = chip.dataset.v; });
  });

  els.refresh.addEventListener('click', refresh);

  /* ---------- install prompt ---------- */
  function setupInstall() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios) {
      els.installText.textContent = 'In Safari, tap the Share button, then "Add to Home Screen". Open the app from there to enable alerts.';
      els.install.hidden = false;
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      els.installText.textContent = 'Install Haze Tracker for one-tap access and alerts.';
      els.installBtn.hidden = false;
      els.install.hidden = false;
      els.installBtn.onclick = function () {
        e.prompt();
        e.userChoice.then(function () { els.install.hidden = true; });
      };
    });
    window.addEventListener('appinstalled', function () { els.install.hidden = true; });
  }

  /* ---------- boot ---------- */
  function boot() {
    els.region.replaceChildren.apply(els.region, Core.REGIONS.map(function (r) {
      var o = document.createElement('option');
      o.value = r;
      o.textContent = Core.REGION_LABELS[r];
      return o;
    }));

    // The service worker must never block the UI: it is registered in parallel.
    var swReady = 'serviceWorker' in navigator
      ? navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; })
          .then(function (reg) { swReg = reg; describeBackground(); })
          .catch(function () {})
      : Promise.resolve();

    Promise.all([Core.getSettings(), Core.getSnapshot()]).then(function (r) {
      settings = r[0];
      snapshot = r[1] || null;
      els.region.value = settings.region;
      els.threshold.value = settings.threshold;
      els.apikey.value = settings.apiKey || '';
      syncUi();
      describeBackground();
      render();
      setupInstall();
      // Give the worker a moment so a threshold alert on first load can be shown, but don't wait long.
      return Promise.race([swReady, new Promise(function (res) { setTimeout(res, 1500); })]);
    }).then(refresh);

    setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  boot();
})();
