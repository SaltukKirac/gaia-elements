/*! gx-el loader v1 | Gaia (Octonom) Bubble HTML elements served from GitHub (SaltukKirac/gaia-elements) via jsDelivr.
 *
 * Bubble holds only a stub per element:  <div data-gx-el="NAME" hidden></div>  + a tiny script that loads this file.
 * Flow per page view:
 *   manifest.json  (@channel, revalidated every page load)  ->  { elements: { NAME: { commit, path } } }
 *   el/NAME.html   (@commit, immutable, browser-cached)      ->  replaces the placeholder in place
 *   (the stub prefetches the main manifest in parallel with this file: window.__gxElMan)
 *   <script> tags of the element then run in document order; external ones are awaited (3 s cap) like a parser would,
 *   inline ones see document.currentScript = themselves. type="application/json" data blocks stay inert.
 * Channel: page URL ?gxel=dev (kept for the tab session), ?gxel=main resets. Harness: set window.__gxElLocal = 'http://host/'.
 * Debug: window.__gxEl (mounted, errors, manifest), console lines prefixed [gx-el], window event 'gx:el-mounted'.
 * Source of truth: elementler/element-deploy/loader.js (deployed by element-deploy.ps1). Do not edit on GitHub.
 */
(function (W, D) {
  'use strict';
  if (W.__gxEl && W.__gxEl.v) { W.__gxEl.scan(); return; }

  var REPO = 'SaltukKirac/gaia-elements';
  var CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@';
  var RAW = 'https://raw.githubusercontent.com/' + REPO + '/';
  var EXT_TIMEOUT_MS = 3000;
  var JS_TYPE = /^(|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module)$/i;
  var SAFE_REF = /^[A-Za-z0-9._\/-]{1,100}$/;
  var SAFE_SHA = /^[0-9a-f]{7,40}$/;
  var SAFE_PATH = /^[A-Za-z0-9._\/-]{1,200}$/;

  var LOCAL = typeof W.__gxElLocal === 'string' && /^https?:\/\//.test(W.__gxElLocal) ? W.__gxElLocal : null;
  var channel = readChannel();
  var manifestP = null;
  var bodies = {};

  var api = W.__gxEl = {
    v: 1,
    channel: channel,
    local: LOCAL,
    manifest: null,
    mounted: {},
    errors: [],
    scan: scan
  };

  function readChannel() {
    var c = null, KEY = 'gxel';
    try { var m = /[?&]gxel=([^&#]*)/.exec(location.search || ''); if (m) c = decodeURIComponent(m[1]); } catch (e) { c = null; }
    try {
      if (c !== null) {
        if (!c || c === 'main') sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, c);
      } else {
        c = sessionStorage.getItem(KEY);
      }
    } catch (e) { /* storage blocked: URL value (or main) still applies */ }
    return c && SAFE_REF.test(c) ? c : 'main';
  }

  function log(level, msg, extra) {
    try {
      var fn = console[level] || console.log;
      if (extra === undefined) fn.call(console, '[gx-el] ' + msg); else fn.call(console, '[gx-el] ' + msg, extra);
    } catch (e) { /* no console */ }
  }

  function now() { return W.performance && performance.now ? performance.now() : Date.now(); }

  function isConnected(node) {
    if (typeof node.isConnected === 'boolean') return node.isConnected;
    return D.documentElement.contains(node);
  }

  function fetchFirst(urls, cacheMode) {
    var i = 0, lastErr = null;
    function next() {
      if (i >= urls.length) return Promise.reject(lastErr || new Error('no source'));
      var url = urls[i++];
      return fetch(url, { cache: cacheMode, credentials: 'omit', mode: 'cors' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.text();
      }).catch(function (e) {
        lastErr = e;
        if (i < urls.length) log('warn', 'source failed, trying fallback: ' + url, String(e && e.message || e));
        return next();
      });
    }
    return next();
  }

  function getManifest() {
    if (!manifestP) {
      var urls = LOCAL ? [LOCAL + 'manifest.json'] : [CDN + channel + '/manifest.json', RAW + channel + '/manifest.json'];
      var pre = W.__gxElMan;
      if (pre) W.__gxElMan = null;
      var textP = !LOCAL && channel === 'main' && pre && typeof pre.then === 'function'
        ? pre.then(function (t) { if (typeof t !== 'string' || !t) throw new Error('empty prefetch'); return t; })
          .catch(function () { return fetchFirst(urls, 'no-cache'); })
        : fetchFirst(urls, 'no-cache');
      manifestP = textP.then(function (text) {
        var m = JSON.parse(text);
        if (!m || typeof m.elements !== 'object') throw new Error('manifest has no elements');
        api.manifest = m;
        return m;
      });
      manifestP.catch(function () { manifestP = null; });
    }
    return manifestP;
  }

  function getBody(entry) {
    var key = entry.commit + '/' + entry.path;
    if (!bodies[key]) {
      var urls = LOCAL ? [LOCAL + entry.path + '?c=' + entry.commit]
        : [CDN + entry.commit + '/' + entry.path, RAW + entry.commit + '/' + entry.path];
      bodies[key] = fetchFirst(urls, LOCAL ? 'no-store' : 'default');
      bodies[key].catch(function () { delete bodies[key]; });
    }
    return bodies[key];
  }

  function scan() {
    var list = D.querySelectorAll('[data-gx-el]:not([data-gx-state])');
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  function mount(ph) {
    var name = ph.getAttribute('data-gx-el');
    var t0 = now();
    ph.setAttribute('data-gx-state', 'loading');
    getManifest().then(function (m) {
      var entry = Object.prototype.hasOwnProperty.call(m.elements, name) ? m.elements[name] : null;
      if (!entry) throw new Error('element "' + name + '" is not in the manifest (' + channel + ')');
      if (!SAFE_SHA.test(String(entry.commit)) || !SAFE_PATH.test(String(entry.path))) throw new Error('bad manifest entry for ' + name);
      return getBody(entry).then(function (html) { return { entry: entry, html: html }; });
    }).then(function (res) {
      if (!isConnected(ph)) { log('info', name + ': placeholder left the page before mount (element re-rendered), skipped'); return; }
      inject(ph, res.html, function () {
        var ms = Math.round(now() - t0);
        var rec = api.mounted[name] || { count: 0 };
        rec.commit = res.entry.commit;
        rec.ms = ms;
        rec.at = new Date().toISOString();
        rec.count += 1;
        api.mounted[name] = rec;
        log('info', name + ' @' + res.entry.commit.slice(0, 7) + (channel !== 'main' ? ' [' + channel + ']' : '') +
          (LOCAL ? ' [local]' : '') + ' mounted in ' + ms + ' ms');
        try {
          W.dispatchEvent(new CustomEvent('gx:el-mounted', { detail: { name: name, commit: res.entry.commit, channel: channel } }));
        } catch (e) { /* old browser */ }
      });
    }).catch(function (e) {
      api.errors.push({ name: name, error: String(e && e.message || e), at: new Date().toISOString() });
      log('error', name + ' could not be loaded', e);
      if (isConnected(ph)) {
        ph.setAttribute('data-gx-state', 'error');
        ph.hidden = false;
        ph.style.cssText = 'padding:12px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;' +
          'border-radius:10px;font:13px/1.4 Inter,system-ui,sans-serif';
        ph.textContent = 'This component could not be loaded. Please refresh the page.';
      }
    });
  }

  // Markup goes in first (scripts inert), then scripts run in order: same shape as the element being parsed in place.
  function inject(ph, html, done) {
    var tpl = D.createElement('template');
    tpl.innerHTML = html;
    var frag = tpl.content;
    var scripts = Array.prototype.slice.call(frag.querySelectorAll('script'));
    ph.parentNode.replaceChild(frag, ph);
    runScripts(scripts, 0, done);
  }

  function runScripts(list, i, done) {
    for (; i < list.length; i++) {
      var old = list[i];
      if (!old.parentNode) continue;
      if (!JS_TYPE.test((old.getAttribute('type') || '').trim())) continue;
      var s = D.createElement('script');
      for (var a = 0; a < old.attributes.length; a++) s.setAttribute(old.attributes[a].name, old.attributes[a].value);
      if (old.hasAttribute('src')) {
        if (old.hasAttribute('async') || old.hasAttribute('defer')) { old.parentNode.replaceChild(s, old); continue; }
        waitFor(s, list, i, done);
        old.parentNode.replaceChild(s, old);
        return;
      }
      s.text = old.text;
      old.parentNode.replaceChild(s, old);
    }
    if (done) done();
  }

  function waitFor(s, list, i, done) {
    var fired = false, timer = null;
    function go() {
      if (fired) return;
      fired = true;
      if (timer) clearTimeout(timer);
      runScripts(list, i + 1, done);
    }
    s.onload = go;
    s.onerror = function () { log('warn', 'external script failed, continuing: ' + s.src); go(); };
    timer = setTimeout(function () { log('warn', 'external script slow (>' + EXT_TIMEOUT_MS / 1000 + ' s), continuing: ' + s.src); go(); }, EXT_TIMEOUT_MS);
  }

  scan();
  setTimeout(scan, 400);
})(window, document);
