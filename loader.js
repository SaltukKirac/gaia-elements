/*! gx-el loader v2 | Gaia (Octonom) Bubble HTML elements served from GitHub (SaltukKirac/gaia-elements) via jsDelivr.
 *
 * Bubble holds only a stub per element:  <div data-gx-el="NAME" hidden></div>  + a tiny script that loads this file.
 * Flow per page view:
 *   manifest.json  (@channel, revalidated every page load)  ->  { elements: { NAME: { commit, path } } }
 *   el/NAME.html   (@commit, immutable, browser-cached)      ->  replaces the placeholder in place
 *   (the stub prefetches the main manifest in parallel with this file: window.__gxElMan)
 *   <script> tags of the element then run in document order; external ones are awaited (3 s cap) like a parser would,
 *   inline ones see document.currentScript = themselves. type="application/json" data blocks stay inert.
 * Channel: page URL ?gxel=dev (kept for the tab session), ?gxel=main resets. Harness: set window.__gxElLocal = 'http://host/'.
 * v2 (30.09.2026): deferred globals. Bubble "Run javascript" actions call element entry points (gaiaNotifyToolkits(...),
 *   window.dynamicTable.refresh(), ...) as soon as their workflow fires; with the code coming from the CDN the element may
 *   not be mounted yet (or not be on the page at all). Until the real function exists a shim queues the call; every mount
 *   replays the queue in call order. A shim never replaces something that already exists. Stub v2 installs the same
 *   shims synchronously (window.__gxElShim) so the gap before this file arrives is covered too; the loader adopts them.
 *   The two name lists live in element-deploy.ps1 ($StubTemplate) and here; the deploy script checks they match.
 * Debug: window.__gxEl (mounted, errors, manifest, shims), console lines prefixed [gx-el], window event 'gx:el-mounted'.
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

  // Entry points Bubble workflows call on the elements (window.NAME = function ... inside the element code).
  // Only names that are called FROM Bubble go here. Names other code probes with typeof (gaiaSetTab,
  // gaiaOpenAgentDashboard, gaiaTriggerOnboarding, gaiaConnectApp, bubble_fn_hydratePromptBuilder, flagship helpers,
  // dynamicTable.refreshTable/setTableData/reloadFromConfig ...) stay out: a shim would make that probe true and hide
  // the fallback path. GX-SHIM-FN / GX-SHIM-OBJ markers: element-deploy.ps1 compares these with the stub template.
  var SHIM_FN = /*GX-SHIM-FN*/'gaiaNotifyToolkits,gaiaNotifyTools,gaiaNotifyTriggers,gaiaNotifyConnected,gaiaNotifyAuthCheck,gaiaNotifyResponse,gaiaNotifyContext,gaiaNotifyCustomFields,gaiaOnScheduleStatus,gaiaReceiveKnowledgeUrls,gaiaTmplLoad,gaiaAutomationCompleted,gaiaIngestResponse,gaiaHandleArchitectToolCall,gaiaRouting,gaiaSetOpenAIKey,setTableData,refreshTable,reloadFromConfig,refreshTableAssistant,bubble_fn_notifyCustomFields,bdf_setUploaderUrls,bdf_setUploaderUrlsByUploaderId,bdf_resetUploaderByField,bdf_resetUploaderByUploaderId,bdf_forceUnlockUi'/*GX-SHIM-FN*/.split(',');
  // Objects Bubble calls methods on. The element assigns a NEW object (window.dynamicTable = {...}); the queue is
  // replayed once the global no longer points at the shim object.
  var SHIM_OBJ = /*GX-SHIM-OBJ*/'dynamicTable:refresh|setAssistant|wakeResult,gaiaRoutingManager:onRoutingResponse|send'/*GX-SHIM-OBJ*/;
  var REPLAY_LATER_MS = [0, 1000, 4000];   // an element may define its globals a beat after its scripts ran
  var QUEUE_CAP = 20;                      // per key; these are "latest state" notifications, older ones are dropped

  var LOCAL = typeof W.__gxElLocal === 'string' && /^https?:\/\//.test(W.__gxElLocal) ? W.__gxElLocal : null;
  var channel = readChannel();
  var manifestP = null;
  var bodies = {};
  var shimQ = [];      // [{ k: 'name' | 'obj.method', a: [args] }] in call order
  var shimFns = {};    // name -> shim function (identity: "still the shim?")
  var shimObjs = {};   // obj -> shim object
  var shimSeen = {};   // key -> number of calls queued so far (log once per key)

  var api = W.__gxEl = {
    v: 2,
    channel: channel,
    local: LOCAL,
    manifest: null,
    mounted: {},
    errors: [],
    shims: { queued: 0, replayed: 0, dropped: 0, pending: pendingShims },
    scan: scan,
    replay: replayShims
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

  // ---- deferred globals
  function enqueue(key, args) {
    var n = 0, i;
    for (i = 0; i < shimQ.length; i++) if (shimQ[i].k === key) n++;
    if (n >= QUEUE_CAP) {
      for (i = 0; i < shimQ.length; i++) if (shimQ[i].k === key) { shimQ.splice(i, 1); api.shims.dropped += 1; break; }
    }
    shimQ.push({ k: key, a: args });
    api.shims.queued += 1;
    shimSeen[key] = (shimSeen[key] || 0) + 1;
    if (shimSeen[key] === 1) log('info', key + ' was called before its element mounted; queued');
  }

  function makeShim(key) {
    var f = function () { enqueue(key, Array.prototype.slice.call(arguments)); };
    f.__gxShim = true;
    return f;
  }

  function parseObj(spec) {
    var out = {}, parts = spec.split(','), i, kv;
    for (i = 0; i < parts.length; i++) { kv = parts[i].split(':'); out[kv[0]] = kv[1].split('|'); }
    return out;
  }

  // Stub v2 installed the same shims synchronously and kept their queue in window.__gxElShim
  // ({ fns, objs, q: [{ k, a }, ...] }). Take them over: the stub's functions are re-pointed at loader shims (same
  // global names, same object identity for dynamicTable/gaiaRoutingManager), its queue is imported in order.
  function adoptStubShims() {
    var S = W.__gxElShim, k, m, o, q, i;
    if (!S || typeof S !== 'object' || S.adopted) return;
    try {
      q = S.q || [];
      for (i = 0; i < q.length; i++) if (q[i] && typeof q[i].k === 'string') enqueue(q[i].k, q[i].a || []);
      S.q = [];
      if (S.fns) for (k in S.fns) {
        if (!Object.prototype.hasOwnProperty.call(S.fns, k)) continue;
        try { if (W[k] === S.fns[k]) { shimFns[k] = W[k] = makeShim(k); } } catch (e1) { /* non-writable */ }
      }
      if (S.objs) for (k in S.objs) {
        if (!Object.prototype.hasOwnProperty.call(S.objs, k)) continue;
        o = S.objs[k];
        if (W[k] !== o) continue;
        for (m in o) if (Object.prototype.hasOwnProperty.call(o, m) && typeof o[m] === 'function' && o[m].__gxShim) o[m] = makeShim(k + '.' + m);
        shimObjs[k] = o;
      }
      S.adopted = true;
      if (q.length) log('info', 'adopted ' + q.length + ' call(s) queued by the stub before the loader arrived');
    } catch (e) { log('warn', 'stub shim adoption failed', e); }
  }

  function installShims() {
    var i, n, o, ms, objs = parseObj(SHIM_OBJ);
    adoptStubShims();
    for (i = 0; i < SHIM_FN.length; i++) {
      n = SHIM_FN[i];
      try { if (typeof W[n] === 'undefined') { shimFns[n] = W[n] = makeShim(n); } } catch (e) { /* non-writable global */ }
    }
    for (n in objs) {
      if (!Object.prototype.hasOwnProperty.call(objs, n)) continue;
      try {
        if (W[n] === undefined || W[n] === null) {
          o = {}; ms = objs[n];
          for (i = 0; i < ms.length; i++) o[ms[i]] = makeShim(n + '.' + ms[i]);
          o.__gxShim = true;
          shimObjs[n] = W[n] = o;
        }
      } catch (e) { /* non-writable global */ }
    }
  }

  function pendingShims() {
    var out = {}, i;
    for (i = 0; i < shimQ.length; i++) out[shimQ[i].k] = (out[shimQ[i].k] || 0) + 1;
    return out;
  }

  // Replays, in call order, every queued call whose real target now exists; the rest stay queued.
  function replayShims() {
    if (!shimQ.length) return;
    var keep = [], done = {}, i, e, parts, target, fn, ready;
    for (i = 0; i < shimQ.length; i++) {
      e = shimQ[i];
      parts = e.k.split('.');
      ready = false; target = null; fn = null;
      if (parts.length === 1) {
        fn = W[e.k];
        if (typeof fn === 'function' && fn !== shimFns[e.k] && !fn.__gxShim) { target = W; ready = true; }
      } else {
        target = W[parts[0]];
        if (target && target !== shimObjs[parts[0]] && !target.__gxShim) {
          fn = target[parts[1]];
          if (typeof fn === 'function') ready = true;
          else { log('warn', e.k + ': element mounted without this method, call dropped'); api.shims.dropped += 1; continue; }
        }
      }
      if (!ready) { keep.push(e); continue; }
      try { fn.apply(target, e.a); api.shims.replayed += 1; done[e.k] = (done[e.k] || 0) + 1; }
      catch (x) { log('error', e.k + ': replayed call threw', x); }
    }
    shimQ.length = 0;
    for (i = 0; i < keep.length; i++) shimQ.push(keep[i]);
    for (i in done) if (Object.prototype.hasOwnProperty.call(done, i)) log('info', i + ': ' + done[i] + ' queued call(s) replayed');
  }

  function replaySoon() {
    for (var i = 0; i < REPLAY_LATER_MS.length; i++) setTimeout(replayShims, REPLAY_LATER_MS[i]);
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
    replayShims();
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
        replayShims();
        replaySoon();
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

  installShims();
  scan();
  setTimeout(scan, 400);
})(window, document);
