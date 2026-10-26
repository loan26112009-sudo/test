/*
 * Reframe 360 Pro — panel application.
 */
(function (root) {
  'use strict';

  var M = R360.math, KF = R360.keyframes, host = R360.host, ff = R360.ffmpeg || null;
  var req = host.hasNode ? root.require : null;
  var fs = req ? req('fs') : null, path = req ? req('path') : null, os = req ? req('os') : null;
  var DEG = M.DEG;

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function even(v) { v = Math.round(+v || 0); return Math.max(64, v - (v % 2)); }
  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function fileUrl(p) {
    p = p.replace(/\\/g, '/');
    return (p.charAt(0) === '/' ? 'file://' : 'file:///') + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  // ---------------------------------------------------------------- settings

  var DEFAULTS = {
    format: 'seq', outW: 3840, outH: 2160, codec: 'prores_hq', filter: 'lanczos', ss: 'auto',
    mb: false, shutter: 180, sharpen: 0, audio: false, after: 'place', disableOrig: true,
    outDir: '', ffmpeg: '', hw: true, prevW: 4096, cacheFps: 12, grid: true, horizon: true, sync: true, ease: 'smooth'
  };
  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('r360.settings') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem('r360.settings', JSON.stringify(S.set)); } catch (e) {} }

  var DEFAULT_CAM = { yaw: 0, pitch: 0, roll: 0, fov: 100, dist: 0.12 };
  var CODEC_NAMES = ff ? ff.CODECS : {
    prores_hq: { name: 'Apple ProRes 422 HQ — 10 bits (recommandé)', ext: '.mov' },
    prores_4444: { name: 'Apple ProRes 4444 — 10 bits 4:4:4', ext: '.mov' },
    dnxhr_hqx: { name: 'Avid DNxHR HQX — 10 bits', ext: '.mov' },
    hevc_10: { name: 'H.265 10 bits — qualité max (fichier léger)', ext: '.mp4' },
    h264_hq: { name: 'H.264 8 bits — haute qualité (compatibilité)', ext: '.mp4' }
  };
  // approximate bits per pixel per frame, for the size estimate
  var CODEC_BPP = { prores_hq: 3.55, prores_4444: 5.3, dnxhr_hqx: 3.6, hevc_10: 0.45, h264_hq: 0.7 };

  var S = {
    set: loadSettings(),
    tools: null, media: null, clip: null, seq: null,
    range: { in: 0, out: 10 }, time: 0, fps: 30,
    cam: clone(DEFAULT_CAM), baseCam: clone(DEFAULT_CAM), corr: { yaw: 0, pitch: 0, roll: 0 },
    track: new KF.KeyframeTrack(), selKey: null, dirty: false, autoKey: false,
    playing: false, cache: null, cacheDone: 0, exporting: null, dragging: false
  };

  // ---------------------------------------------------------------- renderer & canvases

  var viewer = $('viewer'), glCanvas = $('gl'), ovl = $('ovl'), tl = $('tl'), mini = $('mini');
  var R;
  try { R = new R360.Reframer(glCanvas); }
  catch (e) { status(e.message, 'err'); return; }
  var miniSrc = document.createElement('canvas'); miniSrc.width = 1024; miniSrc.height = 512;

  function setMiniSource(src) {
    var g = miniSrc.getContext('2d');
    if (src.data) {
      var tmp = document.createElement('canvas'); tmp.width = src.width; tmp.height = src.height;
      tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.data.buffer, src.data.byteOffset, src.width * src.height * 4), src.width, src.height), 0, 0);
      src = tmp;
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, miniSrc.width, miniSrc.height);
  }

  function setPreview(src) { R.setPreviewSource(src); setMiniSource(src); requestDraw(); }

  function outSize() {
    var f = S.set.format;
    if (f === 'custom') return [even(S.set.outW), even(S.set.outH)];
    if (f === 'seq') return S.seq && S.seq.width ? [even(S.seq.width), even(S.seq.height)] : [3840, 2160];
    for (var i = 0; i < M.FORMATS.length; i++) if (M.FORMATS[i].id === f) return [M.FORMATS[i].w, M.FORMATS[i].h];
    return [3840, 2160];
  }

  function dpr() { return Math.min(2, root.devicePixelRatio || 1); }

  function frameRect() {
    var cw = glCanvas.width, ch = glCanvas.height, o = outSize(), ar = o[0] / o[1], pad = Math.round(14 * dpr());
    var w = cw - 2 * pad, h = ch - 2 * pad;
    if (w / h > ar) w = h * ar; else h = w / ar;
    return { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(h)) };
  }

  function resize() {
    var d = dpr();
    [[glCanvas, viewer], [ovl, viewer], [tl, tl.parentNode], [mini, mini]].forEach(function (p) {
      var w = Math.max(2, Math.round(p[1].clientWidth * d)), h = Math.max(2, Math.round(p[1].clientHeight * d));
      if (p[0] === mini) h = Math.round(w / 2);
      if (p[0].width !== w || p[0].height !== h) { p[0].width = w; p[0].height = h; }
    });
    requestDraw();
  }

  var drawQueued = false;
  function requestDraw() { if (!drawQueued) { drawQueued = true; root.requestAnimationFrame(draw); } }

  function currentView() {
    var o = outSize();
    return { matrix: M.cameraMatrix(S.cam, S.corr), scale: M.lensScale(S.cam.fov, S.cam.dist), dist: S.cam.dist, outW: o[0], outH: o[1] };
  }

  function draw() {
    drawQueued = false;
    var rect = frameRect(), view = currentView();
    R.renderPreview(view, rect, [0, 0, 0]);
    drawOverlay(rect, view);
    drawTimeline();
    drawMini();
    updateHud(view);
  }

  // ---------------------------------------------------------------- overlay (grid + horizon)

  function drawOverlay(rect, view) {
    var g = ovl.getContext('2d'), d = dpr();
    g.clearRect(0, 0, ovl.width, ovl.height);
    g.save();
    g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip();
    if (S.set.grid) {
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      g.beginPath();
      for (var i = 1; i < 3; i++) {
        var x = Math.round(rect.x + rect.w * i / 3) + 0.5, y = Math.round(rect.y + rect.h * i / 3) + 0.5;
        g.moveTo(x, rect.y); g.lineTo(x, rect.y + rect.h); g.moveTo(rect.x, y); g.lineTo(rect.x + rect.w, y);
      }
      g.stroke();
      var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, s = 7 * d;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.moveTo(cx - s, cy); g.lineTo(cx + s, cy); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); g.stroke();
    }
    if (S.set.horizon) {
      var he = M.halfExtent(view.outW, view.outH), V = M.transpose(M.viewMatrix(S.cam.yaw, S.cam.pitch, S.cam.roll));
      g.strokeStyle = 'rgba(255,200,60,0.85)'; g.lineWidth = 1.5 * d; g.setLineDash([6 * d, 5 * d]);
      g.beginPath();
      var prev = null;
      for (var lon = -180; lon <= 180; lon += 1.5) {
        var p = M.projectCam(M.matVec(V, M.lonLatToDir(lon * DEG, 0)), view.scale, view.dist), pt = null;
        if (p && Math.abs(p[0]) < 4 && Math.abs(p[1]) < 4) {
          pt = [rect.x + (p[0] / he[0] + 1) / 2 * rect.w, rect.y + (1 - p[1] / he[1]) / 2 * rect.h];
        }
        if (pt && prev && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < rect.w * 0.5) g.lineTo(pt[0], pt[1]);
        else if (pt) g.moveTo(pt[0], pt[1]);
        prev = pt;
      }
      g.stroke(); g.setLineDash([]);
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
  }

  // ---------------------------------------------------------------- minimap

  function drawMini() {
    var g = mini.getContext('2d'), w = mini.width, h = mini.height, d = dpr();
    g.imageSmoothingQuality = 'high';
    g.drawImage(miniSrc, 0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, h);
    var view = currentView(), he = M.halfExtent(view.outW, view.outH), C = view.matrix;
    var pts = [], N = 32, edges = [[-1, 1, 1, 1], [1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1]];
    edges.forEach(function (e) {
      for (var i = 0; i < N; i++) {
        var a = i / N, nx = (e[0] + (e[2] - e[0]) * a) * he[0], ny = (e[1] + (e[3] - e[1]) * a) * he[1];
        var r = M.camRay(nx, ny, view.scale, view.dist);
        pts.push(r ? M.dirToEquirect(M.matVec(C, r), w, h) : null);
      }
    });
    pts.push(pts[0]);
    g.strokeStyle = '#3d8bff'; g.lineWidth = 2 * d; g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[i - 1];
      if (!p) continue;
      if (!q || Math.abs(p[0] - q[0]) > w / 2) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.stroke();
    var c = M.dirToEquirect(M.matVec(C, [0, 0, 1]), w, h);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(c[0], c[1], 3.5 * d, 0, 7); g.fill();
    g.strokeStyle = '#3d8bff'; g.lineWidth = 2 * d; g.stroke();
  }

  function aimFromMini(e) {
    var r = mini.getBoundingClientRect();
    var u = clamp((e.clientX - r.left) / r.width, 0, 1), v = clamp((e.clientY - r.top) / r.height, 0, 1);
    var src = M.lonLatToDir((u - 0.5) * 2 * Math.PI, (0.5 - v) * Math.PI);
    var w = M.matVec(M.transpose(M.correctionMatrix(S.corr)), src);
    editCam({ yaw: Math.atan2(w[0], w[2]) / DEG, pitch: Math.asin(clamp(w[1], -1, 1)) / DEG });
  }

  // ---------------------------------------------------------------- HUD & source info

  function fmtTC(sec) {
    var fr = Math.max(0, Math.round(sec * S.fps)), fi = Math.max(1, Math.round(S.fps));
    var f = fr % fi, s = Math.floor(fr / fi), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(f);
  }

  function lensName() {
    for (var i = 0; i < M.PRESETS.length; i++) {
      var p = M.PRESETS[i];
      if (Math.abs(p.fov - S.cam.fov) < 0.6 && Math.abs(p.dist - S.cam.dist) < 0.02 && (p.pitch === undefined || Math.abs(p.pitch - S.cam.pitch) < 1)) return p.id;
    }
    return null;
  }

  function updateHud(view) {
    var o = outSize(), id = lensName(), p = null;
    for (var i = 0; i < M.PRESETS.length; i++) if (M.PRESETS[i].id === id) p = M.PRESETS[i];
    $('hudLens').textContent = (p ? p.name + ' · ' : '') + 'FOV ' + Math.round(M.effectiveFov(S.cam.fov, S.cam.dist)) + '° · courbure ' + S.cam.dist.toFixed(2);
    var ss = S.set.ss === 'auto' ? M.autoSupersample(S.media ? S.media.width : 7680, o[0], o[1], S.cam.fov, S.cam.dist) : +S.set.ss;
    $('hudFmt').textContent = o[0] + '×' + o[1] + ' · SS ' + ss + '×' + ss;
    $('tcCur').textContent = fmtTC(S.time - S.range.in);
    $('tcDur').textContent = fmtTC(S.range.out - S.range.in);
    $('flagDirty').classList.toggle('on', S.dirty);
    var lenses = document.querySelectorAll('.lens');
    for (var j = 0; j < lenses.length; j++) lenses[j].classList.toggle('on', lenses[j].getAttribute('data-id') === id);
  }

  function updateSrcInfo() {
    var n = document.querySelector('.src-name'), m = document.querySelector('.src-meta');
    if (!S.media) { n.textContent = 'Mode démo'; return; }
    var i = S.media;
    n.textContent = (S.clip ? S.clip.name + '  ·  ' : '') + i.name;
    var warn = [];
    if (!i.isEquirect) warn.push('pas un équirectangulaire 2:1 (exporte d\'abord en 360 depuis DJI Studio / Insta360 Studio)');
    if (S.clip && Math.abs(S.clip.speed - 1) > 1e-3) warn.push('vitesse du clip ' + Math.round(S.clip.speed * 100) + ' % : rendu à 100 %, réapplique la vitesse ensuite');
    m.innerHTML = '';
    m.appendChild(document.createTextNode(i.width + '×' + i.height + ' · ' + (Math.round(i.fps * 1000) / 1000) + ' im/s · ' + i.codec.toUpperCase() + ' ' + i.bits + ' bits · ' + i.color.transfer + (S.clip ? ' · plage ' + fmtTC(S.range.out - S.range.in) : '')));
    if (warn.length) { var w = document.createElement('span'); w.className = 'warn'; w.textContent = '  ⚠ ' + warn.join(' · '); m.appendChild(w); }
  }

  function status(msg, cls) { var el = $('status'); el.textContent = msg; el.className = cls || ''; }

  // ---------------------------------------------------------------- camera editing

  function tolerance() { return 0.5 / S.fps; }
  function snap(t) { return Math.round(t * S.fps) / S.fps; }
  function lastFrameTime() { return Math.max(S.range.in, snap(S.range.out - 1 / S.fps)); }

  function camAt(t) { return S.track.keys.length ? S.track.evaluate(t) : clone(S.baseCam); }

  function normalizeCam(c) {
    c.yaw = M.wrap180(c.yaw); c.pitch = clamp(c.pitch, -90, 90); c.roll = M.wrap180(c.roll);
    c.fov = clamp(c.fov, 10, 360); c.dist = clamp(c.dist, 0, 3);
  }

  function editCam(patch) {
    for (var k in patch) if (patch.hasOwnProperty(k)) S.cam[k] = patch[k];
    normalizeCam(S.cam);
    var tol = tolerance(), key = S.track.find(S.time, tol);
    if (key) { S.track.set(key.t, S.cam, tol); S.selKey = key; S.dirty = false; scheduleSave(); }
    else if (S.autoKey) { S.selKey = S.track.set(S.time, S.cam, tol, S.set.ease); S.dirty = false; scheduleSave(); }
    else if (S.track.keys.length) S.dirty = true;
    else { S.baseCam = clone(S.cam); scheduleSave(); }
    updateCamUI();
    requestDraw();
  }

  var tween = null;
  function tweenCam(target, ms) {
    var from = clone(S.cam), t0 = performance.now();
    var dyaw = target.yaw !== undefined ? M.wrap180(target.yaw - from.yaw) : 0;
    if (tween) root.cancelAnimationFrame(tween);
    function step(now) {
      var a = Math.min(1, (now - t0) / ms), e = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2, p = {};
      for (var k in target) if (target.hasOwnProperty(k)) p[k] = k === 'yaw' ? from.yaw + dyaw * e : from[k] + (target[k] - from[k]) * e;
      editCam(p);
      tween = a < 1 ? root.requestAnimationFrame(step) : null;
    }
    tween = root.requestAnimationFrame(step);
  }

  function applyPreset(p) {
    var target = { fov: p.fov, dist: p.dist };
    if (p.pitch !== undefined) { target.pitch = p.pitch; target.roll = p.roll; }
    else if (Math.abs(S.cam.pitch) > 80 && S.cam.fov > 200) target.pitch = 0;
    tweenCam(target, 320);
  }

  function aimDirection(dir) {
    var t = { front: { yaw: 0, pitch: 0 }, back: { yaw: 180, pitch: 0 }, left: { yaw: -90, pitch: 0 }, right: { yaw: 90, pitch: 0 }, up: { pitch: 90 }, down: { pitch: -90 } }[dir];
    tweenCam(t, 360);
  }

  function addKey() {
    S.selKey = S.track.set(S.time, S.cam, tolerance(), S.track.find(S.time, tolerance()) ? null : S.set.ease);
    S.dirty = false;
    scheduleSave(); updateCamUI(); requestDraw();
    status('Clé posée à ' + fmtTC(S.time - S.range.in) + ' (' + S.track.keys.length + ' clé' + (S.track.keys.length > 1 ? 's' : '') + ')');
  }

  function deleteKey() {
    var k = S.track.find(S.time, tolerance());
    if (!k) return;
    S.track.remove(k);
    S.selKey = null;
    if (S.track.keys.length) S.cam = S.track.evaluate(S.time); else S.baseCam = clone(S.cam);
    S.dirty = false;
    scheduleSave(); updateCamUI(); requestDraw();
  }

  function resetCam() { tweenCam({ yaw: 0, pitch: 0, roll: 0, fov: DEFAULT_CAM.fov, dist: DEFAULT_CAM.dist }, 320); }

  // ---------------------------------------------------------------- time & images

  function setTime(t, opts) {
    opts = opts || {};
    S.time = clamp(snap(t), S.range.in, lastFrameTime());
    if (S.track.keys.length) { S.cam = S.track.evaluate(S.time); S.dirty = false; }
    S.selKey = S.track.find(S.time, tolerance());
    requestImage(S.time);
    updateCamUI();
    requestDraw();
    if (!opts.fromPremiere) pushPremiere(S.time);
  }

  var img = { timer: null, busy: false, pending: null, hqT: null, cacheFile: null };

  function cacheIndexReady(t) {
    if (!S.cache) return false;
    var i = Math.round((t - S.cache.start) * S.cache.fps);
    return i >= 0 && (i < S.cacheDone - 1 || (S.cacheComplete && i < S.cache.total));
  }

  function showCacheFrame(t) {
    if (!cacheIndexReady(t)) return false;
    var file = S.cache.frameFile(t);
    if (file === img.cacheFile) return true;
    img.cacheFile = file;
    var im = new Image();
    im.onload = function () { if (img.cacheFile === file && (S.playing || img.hqT !== S.time)) setPreview(im); };
    im.src = fileUrl(file);
    return true;
  }

  function requestImage(t) {
    if (!S.media) return;
    var cached = showCacheFrame(t);
    if (S.playing) return;
    clearTimeout(img.timer);
    img.timer = setTimeout(function () { grabHQ(t); }, cached ? 180 : 20);
  }

  function grabHQ(t) {
    if (!S.media || !S.tools) return;
    if (img.busy) { img.pending = t; return; }
    if (img.hqT === t && t === S.time) return;
    img.busy = true;
    $('loading').classList.add('on');
    var media = S.media;
    ff.grabFrame(S.tools, media, t, Math.min(+S.set.prevW, R.maxTextureSize()), S.set.hw).then(function (f) {
      if (media === S.media && Math.abs(t - S.time) < tolerance() && !S.playing) { img.hqT = t; img.cacheFile = null; setPreview(f); }
    }).catch(function (e) {
      status('Aperçu : ' + e.message.split('\n').pop(), 'err');
    }).then(function () {
      img.busy = false;
      $('loading').classList.remove('on');
      if (img.pending !== null) { var p = img.pending; img.pending = null; if (!S.playing && p === S.time) grabHQ(p); }
    });
  }

  // playback
  var playRaf = null;
  function togglePlay() { if (S.playing) stopPlay(); else startPlay(); }
  function startPlay() {
    S.playing = true; $('btnPlay').innerHTML = '&#10074;&#10074;';
    var last = performance.now(), t = S.time >= lastFrameTime() ? S.range.in : S.time;
    function tick(now) {
      if (!S.playing) return;
      t += (now - last) / 1000; last = now;
      if (t > S.range.out) t = S.range.in + (t - S.range.out);
      S.time = t;
      if (S.track.keys.length) S.cam = S.track.evaluate(t);
      showCacheFrame(t);
      draw();
      playRaf = root.requestAnimationFrame(tick);
    }
    playRaf = root.requestAnimationFrame(tick);
  }
  function stopPlay() {
    S.playing = false; $('btnPlay').innerHTML = '&#9654;';
    root.cancelAnimationFrame(playRaf);
    setTime(S.time);
  }

  function stepFrame(n) { if (S.playing) stopPlay(); setTime(S.time + n / S.fps); }
  function jumpKey(dir) {
    if (S.playing) stopPlay();
    var k = dir < 0 ? S.track.prev(S.time, tolerance()) : S.track.next(S.time, tolerance());
    if (k) { S.selKey = k; setTime(k.t); }
  }

  // ---------------------------------------------------------------- timeline

  var TL_PAD = 14;
  function tlX(t) { var d = dpr(), w = tl.width - 2 * TL_PAD * d; return TL_PAD * d + (t - S.range.in) / Math.max(1e-6, S.range.out - S.range.in) * w; }
  function tlT(x) { var d = dpr(), w = tl.width - 2 * TL_PAD * d; return S.range.in + (x - TL_PAD * d) / w * (S.range.out - S.range.in); }

  function drawTimeline() {
    var g = tl.getContext('2d'), W = tl.width, H = tl.height, d = dpr();
    g.clearRect(0, 0, W, H);
    var len = S.range.out - S.range.in, x0 = tlX(S.range.in), x1 = tlX(S.range.out);
    // ruler
    var steps = [1 / S.fps, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if ((x1 - x0) / (len / steps[i]) >= 70 * d) { step = steps[i]; break; }
    g.font = (10 * d) + 'px Segoe UI, sans-serif'; g.fillStyle = '#7b7b84'; g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.textBaseline = 'top';
    g.beginPath();
    for (var t = 0; t <= len + 1e-6; t += step) {
      var x = Math.round(tlX(S.range.in + t)) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, 7 * d);
      var s = Math.round(t * 100) / 100, lab = s >= 60 ? Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2) : (step < 1 ? s.toFixed(1) : String(Math.round(s))) + 's';
      g.fillText(lab, x + 3 * d, 2 * d);
    }
    g.stroke();
    // track area
    var top = 18 * d, bot = H - 8 * d;
    g.fillStyle = '#1a1a1d'; g.fillRect(x0, top, x1 - x0, bot - top);
    // cache coverage
    if (S.cache) {
      var cEnd = S.cacheComplete ? S.range.out : S.cache.start + Math.max(0, S.cacheDone - 1) / S.cache.fps;
      g.fillStyle = 'rgba(47,210,122,0.55)'; g.fillRect(x0, top, Math.max(0, tlX(Math.min(cEnd, S.range.out)) - x0), 2 * d);
    }
    // curves
    if (S.track.keys.length > 1) {
      var curves = [['yaw', -180, 180, 'rgba(61,139,255,0.75)'], ['pitch', -90, 90, 'rgba(139,92,246,0.75)'], ['fov', 10, 360, 'rgba(255,194,51,0.6)']];
      curves.forEach(function (c) {
        g.strokeStyle = c[3]; g.lineWidth = 1.2 * d; g.beginPath();
        var prevY = null;
        for (var px = x0; px <= x1; px += 2 * d) {
          var v = S.track.evaluate(tlT(px))[c[0]], y = bot - 4 * d - (v - c[1]) / (c[2] - c[1]) * (bot - top - 8 * d);
          if (prevY === null || (c[0] === 'yaw' && Math.abs(y - prevY) > (bot - top) * 0.5)) g.moveTo(px, y); else g.lineTo(px, y);
          prevY = y;
        }
        g.stroke();
      });
    }
    // keyframes
    var my = (top + bot) / 2, ks = 6 * d;
    S.track.keys.forEach(function (k) {
      var x = tlX(k.t);
      if (x < x0 - ks || x > x1 + ks) return;
      g.save(); g.translate(x, my); g.rotate(Math.PI / 4);
      g.fillStyle = k === S.selKey ? '#fff' : '#ffc233';
      g.strokeStyle = '#111'; g.lineWidth = 1.5 * d;
      g.fillRect(-ks / 1.4, -ks / 1.4, ks * 1.42, ks * 1.42); g.strokeRect(-ks / 1.4, -ks / 1.4, ks * 1.42, ks * 1.42);
      g.restore();
      if (k.ease === 'hold') { g.fillStyle = '#ffc233'; g.fillRect(x + ks, my - d, 10 * d, 2 * d); }
    });
    // playhead
    var px2 = Math.round(tlX(S.time)) + 0.5;
    g.strokeStyle = '#3d8bff'; g.lineWidth = 2 * d; g.beginPath(); g.moveTo(px2, 10 * d); g.lineTo(px2, H); g.stroke();
    g.fillStyle = '#3d8bff'; g.beginPath(); g.moveTo(px2 - 5 * d, 8 * d); g.lineTo(px2 + 5 * d, 8 * d); g.lineTo(px2, 15 * d); g.fill();
  }

  var tlDrag = null;
  function keyAtX(x) {
    var best = null, bd = 8 * dpr();
    S.track.keys.forEach(function (k) { var dx = Math.abs(tlX(k.t) - x); if (dx < bd) { bd = dx; best = k; } });
    return best;
  }
  tl.addEventListener('pointerdown', function (e) {
    if (S.playing) stopPlay();
    tl.setPointerCapture(e.pointerId);
    var r = tl.getBoundingClientRect(), x = (e.clientX - r.left) * dpr(), k = keyAtX(x);
    S.dragging = true;
    if (k) { S.selKey = k; tlDrag = { key: k, moved: false }; setTime(k.t); }
    else { tlDrag = { scrub: true }; setTime(tlT(x)); }
  });
  tl.addEventListener('pointermove', function (e) {
    if (!tlDrag) return;
    var r = tl.getBoundingClientRect(), x = (e.clientX - r.left) * dpr(), t = clamp(snap(tlT(x)), S.range.in, lastFrameTime());
    if (tlDrag.scrub) { setTime(t); return; }
    var other = S.track.find(t, tolerance());
    if (other && other !== tlDrag.key) return;
    if (Math.abs(tlDrag.key.t - t) > 1e-9) { tlDrag.key.t = t; tlDrag.moved = true; S.track.sort(); setTime(t); }
  });
  function endTl() { if (tlDrag && tlDrag.moved) scheduleSave(); tlDrag = null; S.dragging = false; }
  tl.addEventListener('pointerup', endTl);
  tl.addEventListener('pointercancel', endTl);

  // ---------------------------------------------------------------- viewer interaction

  var vDrag = null;
  viewer.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    viewer.setPointerCapture(e.pointerId);
    vDrag = { x: e.clientX, y: e.clientY, roll: e.shiftKey };
    viewer.classList.add('drag');
    S.dragging = true;
  });
  viewer.addEventListener('pointermove', function (e) {
    if (!vDrag) return;
    var dx = e.clientX - vDrag.x, dy = e.clientY - vDrag.y;
    vDrag.x = e.clientX; vDrag.y = e.clientY;
    if (vDrag.roll) { editCam({ roll: S.cam.roll + dx * 0.25 }); return; }
    var rect = frameRect(), longCss = Math.max(rect.w, rect.h) / dpr();
    var degPx = Math.min(0.6, M.effectiveFov(S.cam.fov, S.cam.dist) / longCss);
    editCam({ yaw: S.cam.yaw - dx * degPx, pitch: S.cam.pitch + dy * degPx });
  });
  function endV() { vDrag = null; viewer.classList.remove('drag'); S.dragging = false; }
  viewer.addEventListener('pointerup', endV);
  viewer.addEventListener('pointercancel', endV);
  viewer.addEventListener('dblclick', function () { tweenCam({ roll: 0 }, 250); });
  viewer.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.altKey) editCam({ dist: S.cam.dist - e.deltaY * 0.0012 });
    else editCam({ fov: S.cam.fov * Math.exp(e.deltaY * 0.0011) });
  }, { passive: false });

  var miniDrag = false;
  mini.addEventListener('pointerdown', function (e) { mini.setPointerCapture(e.pointerId); miniDrag = true; aimFromMini(e); });
  mini.addEventListener('pointermove', function (e) { if (miniDrag) aimFromMini(e); });
  mini.addEventListener('pointerup', function () { miniDrag = false; });

  // ---------------------------------------------------------------- side panel controls

  var camSliders = [], corrSliders = [];
  function slider(container, o) {
    var row = document.createElement('div'); row.className = 'sl';
    row.innerHTML = '<label>' + o.label + '</label><input type="range"><input type="number"><span class="' + (o.kf ? 'kf' : '') + '"></span>';
    var rng = row.children[1], num = row.children[2], kf = row.children[3];
    [rng, num].forEach(function (el) { el.min = o.min; el.max = o.max; el.step = o.step; });
    function onInput(v) { v = +v; if (!isFinite(v)) return; o.set(clamp(v, o.min, o.max)); }
    rng.addEventListener('input', function () { onInput(rng.value); });
    num.addEventListener('change', function () { onInput(num.value); });
    rng.addEventListener('dblclick', function () { onInput(o.def); });
    container.appendChild(row);
    var api = {
      update: function () {
        var v = o.get();
        rng.value = v;
        if (document.activeElement !== num) num.value = (Math.round(v / o.step) * o.step).toFixed(o.step < 1 ? 2 : 0);
        if (o.kf) kf.className = 'kf' + (S.track.find(S.time, tolerance()) ? ' on' : '');
      }
    };
    return api;
  }

  function buildSide() {
    var cs = $('camSliders');
    [['yaw', 'Lacet', -180, 180, 0.1, 0], ['pitch', 'Tangage', -90, 90, 0.1, 0], ['roll', 'Roulis', -180, 180, 0.1, 0],
      ['fov', 'Champ (FOV)', 10, 360, 0.5, DEFAULT_CAM.fov], ['dist', 'Courbure', 0, 3, 0.01, DEFAULT_CAM.dist]].forEach(function (d) {
      camSliders.push(slider(cs, { label: d[1], min: d[2], max: d[3], step: d[4], def: d[5], kf: true,
        get: function () { return S.cam[d[0]]; }, set: function (v) { var p = {}; p[d[0]] = v; editCam(p); } }));
    });
    var cr = $('corrSliders');
    [['pitch', 'Tangage'], ['roll', 'Roulis'], ['yaw', 'Cap']].forEach(function (d) {
      corrSliders.push(slider(cr, { label: d[1], min: -180, max: 180, step: 0.1, def: 0,
        get: function () { return S.corr[d[0]]; }, set: function (v) { S.corr[d[0]] = v; scheduleSave(); updateCamUI(); requestDraw(); } }));
    });
    var sh = slider($('sharpSlider'), { label: 'Netteté', min: 0, max: 1.5, step: 0.05, def: 0,
      get: function () { return +S.set.sharpen; }, set: function (v) { S.set.sharpen = v; saveSettings(); sh.update(); } });
    sh.update();

    var icons = {
      tele: '<rect x="11" y="6" width="8" height="10" rx="1"/>',
      normal: '<rect x="7" y="5" width="16" height="12" rx="1"/>',
      wide: '<rect x="3" y="4" width="24" height="14" rx="1"/>',
      uwide: '<path d="M2 4 Q15 1.5 28 4 L28 18 Q15 20.5 2 18 Z"/>',
      hwide: '<path d="M1 5 Q15 -1 29 5 Q30.5 11 29 17 Q15 23 1 17 Q-0.5 11 1 5 Z"/>',
      fisheye: '<circle cx="15" cy="11" r="9.5"/><path d="M6 11 Q15 6 24 11" opacity=".6"/>',
      planet: '<circle cx="15" cy="12" r="6.5"/><path d="M8.5 12 h13" opacity=".6"/><path d="M15 5.5 v-4 M9 7 l-3-3 M21 7 l3-3" opacity=".6"/>',
      rabbit: '<circle cx="15" cy="11" r="9.5"/><circle cx="15" cy="11" r="3.5"/>',
      ball: '<circle cx="15" cy="11" r="9.5"/><ellipse cx="11.5" cy="7.5" rx="3" ry="1.8" opacity=".6"/>'
    };
    var lens = $('lenses');
    M.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'lens'; b.setAttribute('data-id', p.id); b.title = p.name + ' — FOV ' + p.fov + '°, courbure ' + p.dist;
      b.innerHTML = '<kbd>' + p.key + '</kbd><svg viewBox="0 0 30 22" fill="none" stroke="currentColor" stroke-width="1.6">' + icons[p.id] + '</svg><span>' + p.name + '</span>';
      b.addEventListener('click', function () { applyPreset(p); });
      lens.appendChild(b);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dirs button'), function (b) {
      b.addEventListener('click', function () { aimDirection(b.getAttribute('data-dir')); });
    });

    var ease = $('selEase');
    KF.EASES.forEach(function (e) { var o = document.createElement('option'); o.value = e.id; o.textContent = e.name; ease.appendChild(o); });
    ease.addEventListener('change', function () {
      S.set.ease = ease.value; saveSettings();
      var k = S.track.find(S.time, tolerance());
      if (k) { k.ease = ease.value; scheduleSave(); setTime(S.time); }
    });

    // export
    var fmt = $('selFormat');
    M.FORMATS.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.name; fmt.appendChild(o); });
    var codec = $('selCodec');
    Object.keys(CODEC_NAMES).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = CODEC_NAMES[k].name; codec.appendChild(o); });

    bindSelect('selFormat', 'format', function () { updateFormatUI(); resize(); });
    bindSelect('selCodec', 'codec', updateEstimate);
    bindSelect('selFilter', 'filter');
    bindSelect('selSS', 'ss', function () { updateEstimate(); requestDraw(); });
    bindSelect('selShutter', 'shutter');
    bindSelect('selAfter', 'after');
    bindSelect('selPrevW', 'prevW', function () { img.hqT = null; requestImage(S.time); });
    bindSelect('selCacheFps', 'cacheFps', function () { if (S.media) startCache(); });
    bindCheck('chkMB', 'mb');
    bindCheck('chkAudio', 'audio');
    bindCheck('chkDisable', 'disableOrig');
    bindCheck('chkHw', 'hw');
    bindCheck('chkSync', 'sync');
    ['outW', 'outH'].forEach(function (id) {
      var el = $(id); el.value = S.set[id];
      el.addEventListener('change', function () { S.set[id] = even(el.value); el.value = S.set[id]; saveSettings(); updateEstimate(); resize(); });
    });
    $('chkAutoKey').addEventListener('change', function () { S.autoKey = this.checked; });
    toggleBtn('tgGrid', 'grid'); toggleBtn('tgHorizon', 'horizon');
    updateFormatUI();
  }

  function bindSelect(id, key, after) {
    var el = $(id); el.value = String(S.set[key]);
    if (el.value !== String(S.set[key]) && el.options.length) { S.set[key] = el.options[0].value; el.value = S.set[key]; }
    el.addEventListener('change', function () { S.set[key] = el.value; saveSettings(); if (after) after(); });
  }
  function bindCheck(id, key) {
    var el = $(id); el.checked = !!S.set[key];
    el.addEventListener('change', function () { S.set[key] = el.checked; saveSettings(); });
  }
  function toggleBtn(id, key) {
    var el = $(id); el.classList.toggle('on', !!S.set[key]);
    el.addEventListener('click', function () { S.set[key] = !S.set[key]; el.classList.toggle('on', S.set[key]); saveSettings(); requestDraw(); });
  }

  function updateFormatUI() {
    $('customDims').classList.toggle('on', S.set.format === 'custom');
    var seqOpt = $('selFormat').options[0];
    seqOpt.textContent = 'Comme la séquence' + (S.seq && S.seq.width ? ' — ' + S.seq.width + '×' + S.seq.height : ' (4K UHD par défaut)');
    updateEstimate();
  }

  function updateEstimate() {
    var o = outSize(), len = S.range.out - S.range.in, frames = Math.max(1, Math.round(len * S.fps));
    var mb = o[0] * o[1] * S.fps * (CODEC_BPP[S.set.codec] || 3.5) / 1e6;
    var gb = mb * len / 8 / 1000;
    $('estimate').innerHTML = '<b>' + o[0] + '×' + o[1] + '</b> · ' + (Math.round(S.fps * 100) / 100) + ' im/s · ' + frames + ' images (' + fmtTC(len) + ')<br>' +
      '≈ ' + Math.round(mb) + ' Mb/s · ≈ ' + (gb < 1 ? Math.round(gb * 1000) + ' Mo' : gb.toFixed(1) + ' Go') + ' · ' + (CODEC_NAMES[S.set.codec] || {}).name;
    var dir = outputDir();
    $('outDir').textContent = dir || 'À côté de la source / Reframe360';
  }

  function updateCamUI() {
    camSliders.forEach(function (s) { s.update(); });
    corrSliders.forEach(function (s) { s.update(); });
    var k = S.track.find(S.time, tolerance());
    $('selEase').value = k ? k.ease : S.set.ease;
    $('btnDelKey').disabled = !S.track.find(S.time, tolerance());
  }

  // tabs
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('on', x === b); });
      Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) { p.classList.toggle('on', p.id === 'tab-' + b.getAttribute('data-tab')); });
      resize();
    });
  });

  // ---------------------------------------------------------------- sessions (keyframes persist per clip)

  function appDataDir() {
    if (!fs) return null;
    var base = process.env.APPDATA || path.join(os.homedir(), '.config');
    return path.join(base, 'Reframe360Pro');
  }
  function sessionKey() { return S.media ? S.media.path.toLowerCase() + (S.clip ? '|' + S.clip.nodeId : '') : 'demo'; }
  function sessionFile() { return path.join(appDataDir(), 'sessions', fnv(sessionKey()) + '.json'); }

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 400); }
  function saveSession() {
    var data = JSON.stringify({ v: 1, key: sessionKey(), keys: S.track.toJSON(), baseCam: S.baseCam, corr: S.corr, savedAt: new Date().toISOString() });
    try {
      if (fs && S.media) { fs.mkdirSync(path.dirname(sessionFile()), { recursive: true }); fs.writeFileSync(sessionFile(), data); }
      else localStorage.setItem('r360.session.' + sessionKey(), data);
    } catch (e) { status('Sauvegarde impossible : ' + e.message, 'err'); }
  }
  function loadSession() {
    var raw = null;
    try {
      if (fs && S.media) { if (fs.existsSync(sessionFile())) raw = fs.readFileSync(sessionFile(), 'utf8'); }
      else raw = localStorage.getItem('r360.session.' + sessionKey());
    } catch (e) {}
    S.track = new KF.KeyframeTrack(); S.baseCam = clone(DEFAULT_CAM); S.corr = { yaw: 0, pitch: 0, roll: 0 }; S.selKey = null;
    if (!raw) return false;
    try {
      var d = JSON.parse(raw);
      S.track.load(d.keys || []);
      if (d.baseCam) S.baseCam = d.baseCam;
      if (d.corr) S.corr = d.corr;
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- media loading

  function startCache() {
    if (S.cache) { S.cache.cancel(); S.cache = null; }
    if (!S.media || !S.tools) return;
    var info = S.media, fps = +S.set.cacheFps, width = Math.min(2048, info.width);
    var mtime = 0;
    try { mtime = fs.statSync(info.path).mtimeMs; } catch (e) {}
    var dir = path.join(ff.cacheRoot(), fnv(info.path + '|' + mtime + '|' + S.range.in + '|' + S.range.out + '|' + fps + '|' + width));
    var marker = path.join(dir, 'complete.json'), duration = S.range.out - S.range.in;
    S.cacheDone = 0; S.cacheComplete = false;
    var c;
    if (fs.existsSync(marker)) {
      c = ff.cacheIndex(dir, S.range.in, fps, duration);
      S.cacheComplete = true; S.cacheDone = c.total;
      $('cacheInfo').textContent = 'Cache aperçu prêt';
    } else {
      c = ff.buildCache(S.tools, info, {
        dir: dir, fps: fps, width: width, start: S.range.in, duration: duration, hw: S.set.hw,
        onProgress: function (n, total) {
          S.cacheDone = n;
          $('cacheInfo').textContent = 'Cache aperçu ' + Math.min(100, Math.round(n / Math.max(1, total) * 100)) + ' %';
          if (!S.playing) requestDraw();
        }
      });
      c.done.then(function (ok) {
        if (!ok || S.cache !== c) return;
        S.cacheComplete = true;
        fs.writeFileSync(marker, '{}');
        $('cacheInfo').textContent = 'Cache aperçu prêt';
        requestDraw();
      }).catch(function (e) { $('cacheInfo').textContent = 'Cache indisponible'; console.warn(e); });
    }
    S.cache = c;
  }

  function loadMedia(file, clip) {
    if (!ff || !S.tools) { status('FFmpeg introuvable — lance Install-Windows.bat ou choisis ffmpeg.exe dans Réglages.', 'err'); return Promise.resolve(); }
    if (S.playing) stopPlay();
    status('Analyse de ' + file + '…');
    $('loading').classList.add('on');
    return ff.probe(S.tools, file).then(function (info) {
      if (S.dirty) saveSession();
      S.media = info; S.fps = info.fps; S.clip = clip || null;
      if (clip && clip.seq) S.seq = clip.seq;
      S.range = clip ? { in: clip.inPoint, out: clip.outPoint } : { in: 0, out: info.duration };
      var had = loadSession();
      S.cam = S.track.keys.length ? S.track.evaluate(S.range.in) : clone(S.baseCam);
      S.dirty = false;
      img.hqT = null; img.cacheFile = null;
      updateSrcInfo(); updateFormatUI();
      if (R.maxTextureSize() < info.width) status('⚠ Ton GPU limite les textures à ' + R.maxTextureSize() + ' px (source ' + info.width + ' px). Mets à jour le pilote graphique.', 'err');
      else status((had ? 'Session restaurée (' + S.track.keys.length + ' clés). ' : '') + info.name + ' chargé.', 'ok');
      startCache();
      var t = S.range.in;
      if (clip && clip.seq && clip.seq.player >= clip.start && clip.seq.player <= clip.end) t = clip.inPoint + (clip.seq.player - clip.start);
      setTime(t, { fromPremiere: true });
    }).catch(function (e) {
      status('Impossible de lire ce fichier : ' + e.message, 'err');
    }).then(function () { $('loading').classList.remove('on'); });
  }

  function loadSelection(silent) {
    if (!host.inPremiere) { if (!silent) status('Premiere Pro non détecté (mode démo).', 'err'); return; }
    host.call('r360_getSelection').then(function (r) {
      if (!r.ok) { if (!silent) status(r.error, 'err'); return; }
      loadMedia(r.mediaPath, r);
    }).catch(function (e) { if (!silent) status(e.message, 'err'); });
  }

  // ---------------------------------------------------------------- Premiere sync

  var sync = { last: null, timer: null };
  function pushPremiere(t) {
    if (!S.clip || !S.set.sync || !host.inPremiere || S.playing) return;
    var seqT = S.clip.start + (t - S.clip.inPoint);
    sync.last = seqT;
    if (sync.timer) return;
    sync.timer = setTimeout(function () { sync.timer = null; host.call('r360_setPlayer', sync.last).catch(function () {}); }, 90);
  }
  setInterval(function () {
    if (!S.clip || !S.set.sync || !host.inPremiere || S.playing || S.dragging || S.exporting || sync.timer) return;
    host.call('r360_getPlayer').then(function (r) {
      if (!r.ok || !S.clip) return;
      var seqT = r.seconds;
      if (sync.last !== null && Math.abs(seqT - sync.last) < tolerance()) return;
      sync.last = seqT;
      if (seqT < S.clip.start || seqT >= S.clip.end) return;
      var mt = S.clip.inPoint + (seqT - S.clip.start);
      if (Math.abs(mt - S.time) > tolerance()) setTime(mt, { fromPremiere: true });
    }).catch(function () {});
  }, 300);

  // ---------------------------------------------------------------- export

  function outputDir() {
    if (S.set.outDir) return S.set.outDir;
    if (S.media && path) return path.join(path.dirname(S.media.path), 'Reframe360');
    return '';
  }

  function runExport() {
    if (S.exporting) return;
    if (!S.media || !S.tools || !ff) { status('Charge d\'abord un clip 360 (bouton « Clip sélectionné » ou « Ouvrir… »).', 'err'); return; }
    if (S.playing) stopPlay();
    var media = S.media, o = outSize(), rate = media.rate;
    var t0 = S.range.in, count = Math.max(1, Math.round((S.range.out - S.range.in) * media.fps));
    if (R.maxTextureSize() < media.width) { status('GPU incompatible avec une source de ' + media.width + ' px.', 'err'); return; }
    var dir = outputDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { status('Dossier de sortie inaccessible : ' + e.message, 'err'); return; }
    var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    var base = path.basename(media.path).replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    var out = path.join(dir, base + '_R360_' + o[0] + 'x' + o[1] + '_' + stamp + (ff.CODECS[S.set.codec] || ff.CODECS.prores_hq).ext);

    // Snapshot of the animation: edits made during the render do not affect it.
    var track = new KF.KeyframeTrack(S.track.toJSON()), base0 = clone(S.baseCam), corr = clone(S.corr);
    var camFn = function (t) { return track.keys.length ? track.evaluate(t) : clone(base0); };
    var clip = S.clip ? clone(S.clip) : null, set = clone(S.set);
    if (S.dirty) status('⚠ La modification non posée en clé est ignorée par le rendu.', 'err');

    var exportR = S.exportRenderer || (S.exportRenderer = new R360.Reframer(document.createElement('canvas')));
    var job = { cancelled: false };
    S.exporting = job;
    $('btnRender').disabled = true;
    $('progress').classList.add('on');
    $('progBar').style.width = '0%';
    $('progTxt').textContent = 'Démarrage…';

    function attempt(hw) {
      var decoder = ff.openDecoder(S.tools, media, t0, count, hw);
      var encoder = ff.openEncoder(S.tools, {
        out: out, width: o[0], height: o[1], rate: rate, codec: set.codec, color: media.color,
        audio: set.audio && media.hasAudio ? { path: media.path, t0: t0, duration: count / media.fps } : null,
        sharpen: +set.sharpen
      });
        return R360.exporter.renderJob({
        renderer: exportR, decoder: decoder, encoder: encoder,
        srcW: media.width, srcH: media.height, outW: o[0], outH: o[1], fps: media.fps, t0: t0, count: count,
        camAt: camFn, corr: corr, filter: set.filter, ss: set.ss === 'auto' ? 'auto' : +set.ss,
        motionBlur: { enabled: set.mb, shutter: +set.shutter, samples: 10 },
        isCancelled: function () { return job.cancelled; },
        onProgress: function (n, total, fps) {
          job.progressed = true;
          var eta = (total - n) / Math.max(0.01, fps);
          $('progBar').style.width = (n / total * 100).toFixed(1) + '%';
          $('progTxt').textContent = n + ' / ' + total + ' · ' + fps.toFixed(1) + ' im/s · reste ' + (eta > 90 ? Math.round(eta / 60) + ' min' : Math.round(eta) + ' s');
        }
      }).catch(function (e) {
        if (hw && !job.progressed && !job.cancelled && /Décodage/.test(e.message)) return attempt(false); // GPU decoder refused this file
        throw e;
      });
    }

    status('Rendu en cours → ' + out);
    attempt(set.hw).then(function (res) {
      $('progBar').style.width = '100%';
      $('progTxt').textContent = res.frames + ' images en ' + Math.round(res.seconds) + ' s (' + (res.frames / res.seconds).toFixed(1) + ' im/s)';
      if (set.after === 'none' || !host.inPremiere) { status('✔ Rendu terminé : ' + out, 'ok'); return; }
      return host.call('r360_importAndPlace', {
        path: out, place: set.after === 'place' && !!clip, trackIndex: clip ? clip.trackIndex : -1,
        start: clip ? clip.start : 0, nodeId: clip ? clip.nodeId : '', disableOriginal: set.disableOrig
      }).then(function (r) {
        if (!r.ok) status('Rendu OK mais import impossible : ' + r.error, 'err');
        else status('✔ ' + (r.placed ? 'Plan recadré placé au-dessus du clip d\'origine. ' : 'Importé dans le chutier « Reframe 360 ». ') + (r.note || ''), 'ok');
      });
    }).catch(function (e) {
      try { fs.unlinkSync(out); } catch (e2) {}
      if (e.message === 'CANCELLED') { status('Rendu annulé.'); $('progTxt').textContent = 'Annulé'; }
      else { status('Échec du rendu : ' + e.message.split('\n').slice(-2).join(' '), 'err'); $('progTxt').textContent = 'Erreur'; }
    }).then(function () {
      S.exporting = null;
      $('btnRender').disabled = false;
    });
  }

  // ---------------------------------------------------------------- buttons & keyboard

  $('btnSel').addEventListener('click', function () { loadSelection(false); });
  $('btnOpen').addEventListener('click', function () {
    var f = host.openFileDialog('Ouvrir une vidéo 360 équirectangulaire');
    if (f) loadMedia(f, null); else if (!host.inPremiere) status('Ouverture de fichier disponible dans Premiere.', 'err');
  });
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnFrPrev').addEventListener('click', function () { stepFrame(-1); });
  $('btnFrNext').addEventListener('click', function () { stepFrame(1); });
  $('btnKfPrev').addEventListener('click', function () { jumpKey(-1); });
  $('btnKfNext').addEventListener('click', function () { jumpKey(1); });
  $('btnAddKey').addEventListener('click', addKey);
  $('btnDelKey').addEventListener('click', deleteKey);
  $('btnResetCam').addEventListener('click', resetCam);
  $('btnResetCorr').addEventListener('click', function () { S.corr = { yaw: 0, pitch: 0, roll: 0 }; scheduleSave(); updateCamUI(); requestDraw(); });
  $('btnIn').addEventListener('click', function () { setRange('in'); });
  $('btnOut').addEventListener('click', function () { setRange('out'); });
  $('btnRender').addEventListener('click', runExport);
  $('btnCancel').addEventListener('click', function () { if (S.exporting) S.exporting.cancelled = true; });
  $('btnOutDir').addEventListener('click', function () {
    var d = host.chooseFolder('Dossier des rendus');
    if (d) { S.set.outDir = d; saveSettings(); updateEstimate(); }
  });
  $('btnOpenDir').addEventListener('click', function () {
    var d = outputDir();
    if (d && fs) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} host.openFolder(d); }
  });
  $('btnFF').addEventListener('click', function () {
    var f = host.openFileDialog('Choisir ffmpeg.exe');
    if (f && ff) { S.set.ffmpeg = f; saveSettings(); locateTools(); }
  });
  $('btnClearCache').addEventListener('click', function () {
    if (!fs) return;
    if (S.cache) { S.cache.cancel(); S.cache = null; }
    try { (fs.rmSync || fs.rmdirSync)(ff.cacheRoot(), { recursive: true, force: true }); } catch (e) {}
    status('Cache vidé.');
    if (S.media) startCache();
  });

  function setRange(which) {
    if (S.clip) { status('La plage suit le clip de la timeline (ajuste-la dans Premiere).'); return; }
    if (!S.media) return;
    if (which === 'in') S.range.in = Math.min(S.time, S.range.out - 1 / S.fps);
    else S.range.out = Math.max(S.time + 1 / S.fps, S.range.in + 1 / S.fps);
    updateSrcInfo(); updateEstimate(); startCache(); setTime(S.time);
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    var k = e.key, used = true;
    if (k === ' ') togglePlay();
    else if (k === 'ArrowLeft') { if (e.shiftKey) jumpKey(-1); else stepFrame(-1); }
    else if (k === 'ArrowRight') { if (e.shiftKey) jumpKey(1); else stepFrame(1); }
    else if (k === 'k' || k === 'K') addKey();
    else if (k === 'Delete' || k === 'Backspace') deleteKey();
    else if (k === 'r' || k === 'R') resetCam();
    else if (k === 'i' || k === 'I') setRange('in');
    else if (k === 'o' || k === 'O') setRange('out');
    else if (k === 'g' || k === 'G') $('tgGrid').click();
    else if (k === 'h' || k === 'H') $('tgHorizon').click();
    else if (k === 'Home') setTime(S.range.in);
    else if (k === 'End') setTime(lastFrameTime());
    else if (/^[1-9]$/.test(k)) applyPreset(M.PRESETS[+k - 1]);
    else used = false;
    if (used) e.preventDefault();
  });

  // ---------------------------------------------------------------- init

  function locateTools() {
    if (!ff) {
      $('ffPath').textContent = host.hasNode ? 'Erreur de chargement : ' + (R360.ffmpegLoadError && R360.ffmpegLoadError.message) : 'Non disponible (mode démo)';
      return;
    }
    S.tools = ff.locate(host.extensionDir(), S.set.ffmpeg);
    $('ffPath').textContent = S.tools ? S.tools.ffmpeg : 'Introuvable — lance Install-Windows.bat';
    if (!S.tools) status('FFmpeg introuvable — relance Install-Windows.bat ou choisis ffmpeg.exe dans Réglages.', 'err');
  }

  buildSide();
  locateTools();
  setPreview(R360.demo.makeDemoEquirect(4096));
  S.cam = clone(S.baseCam);
  updateCamUI(); updateEstimate();
  if (root.ResizeObserver) new root.ResizeObserver(resize).observe(viewer);
  root.addEventListener('resize', resize);
  resize();
  setTime(0, { fromPremiere: true });

  if (host.inPremiere) {
    host.call('r360_getSequence').then(function (r) { if (r.ok) { S.seq = r.seq; updateFormatUI(); requestDraw(); } }).catch(function () {});
    loadSelection(true);
  } else {
    status('Mode démo — ouvre ce panneau dans Premiere Pro (Fenêtre › Extensions › Reframe 360 Pro).');
  }

  // exposed for automated UI tests
  root.R360.app = { S: S, setTime: setTime, editCam: editCam, addKey: addKey, applyPreset: applyPreset, draw: draw, resize: resize };
})(window);
