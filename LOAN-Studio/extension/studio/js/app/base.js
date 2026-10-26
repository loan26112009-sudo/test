/*
 * LOAN Studio — shared panel services: Premiere calls, FFmpeg, settings, per-project storage, UI helpers.
 */
(function (root) {
  'use strict';

  var host = root.R360.host, core = root.LS.core;
  var req = host.hasNode ? host.require : null;
  var fs = req ? req('fs') : null, path = req ? req('path') : null, os = req ? req('os') : null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------------ settings (global)

  var DEFAULTS = {
    labelA: 13, labelB: 15, labelC: 7, backupDir: '', ffmpeg: '', hw: true,
    targets: { vo: -6, mu: -18, fx: -12 }, roles: { 0: 'vo', 1: 'mu', 2: 'fx' },
    proxy: { codec: 'cineform', width: 1280, dir: '' }, blancs: { thr: -38, min: 0.45, pad: 0.12 },
    top: { before: 2, after: 4 }, includeB: false, timerMin: 25
  };
  var settings = (function () {
    try { var s = JSON.parse(localStorage.getItem('ls.settings') || '{}'); return Object.assign(clone(DEFAULTS), s); }
    catch (e) { return clone(DEFAULTS); }
  })();
  function saveSettings() { try { localStorage.setItem('ls.settings', JSON.stringify(settings)); } catch (e) {} }

  // Premiere's 16 default label colours (Préférences › Étiquettes), by index.
  var LABELS = [
    ['Violet', '#a990dd'], ['Iris', '#8a9fe5'], ['Caraïbes', '#1fbfa6'], ['Lavande', '#e384e3'], ['Céruléen', '#1d9ee0'],
    ['Forêt', '#4f9e26'], ['Rose', '#f06090'], ['Mangue', '#f39c32'], ['Pourpre', '#9b3ba0'], ['Bleu', '#3b5fd6'],
    ['Sarcelle', '#2c8c8c'], ['Magenta', '#d4237a'], ['Brun clair', '#c9a77c'], ['Vert', '#3fa83f'], ['Marron', '#8e5c2c'], ['Jaune', '#e2c71b']
  ];
  // Sequence marker colours (Marker.setColorByIndex)
  var MARKER = { green: 0, red: 1, purple: 2, orange: 3, yellow: 4, white: 5, blue: 6, cyan: 7 };

  // ------------------------------------------------------------------ project storage

  var ctx = { project: null, seq: null, version: '' };
  var project = {};
  var listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, a) { (listeners[ev] || []).forEach(function (fn) { try { fn(a); } catch (e) { console.error(e); } }); }

  function dataDir() {
    var base = (host.process && host.process.env.APPDATA) || (os ? path.join(os.homedir(), '.config') : '');
    return path.join(base, 'LoanStudio');
  }
  function projectKey() { return ctx.project && ctx.project.path ? ctx.project.path.toLowerCase() : 'sans-projet'; }
  function projectFile() { return path.join(dataDir(), 'projects', core.fnv(projectKey()) + '.json'); }

  function loadProject() {
    var raw = null;
    try {
      if (fs) { if (fs.existsSync(projectFile())) raw = fs.readFileSync(projectFile(), 'utf8'); }
      else raw = localStorage.getItem('ls.project.' + projectKey());
    } catch (e) {}
    try { project = raw ? JSON.parse(raw) : {}; } catch (e) { project = {}; }
    project.key = projectKey();
    emit('project', project);
  }
  var saveTimer = null;
  function saveProject() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var data = JSON.stringify(project, null, 1);
      try {
        if (fs) { R360.ffmpeg.mkdirp(path.dirname(projectFile())); fs.writeFileSync(projectFile(), data); }
        else localStorage.setItem('ls.project.' + projectKey(), data);
      } catch (e) { toast('Sauvegarde des données impossible : ' + e.message, 'err'); }
    }, 300);
  }

  // Folder next to the .prproj where LOAN Studio writes its files (placeholders...).
  function projectWorkDir(sub) {
    if (!path || !ctx.project || !ctx.project.path) return null;
    return path.join(path.dirname(ctx.project.path), 'LOAN Studio', sub);
  }

  // ------------------------------------------------------------------ Premiere calls

  // Resolves with the host result, rejects with its error message.
  function run(fn) {
    var args = Array.prototype.slice.call(arguments);
    return host.call.apply(null, args).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Erreur Premiere');
      return r;
    });
  }

  function refreshContext() {
    if (!host.inPremiere) return Promise.resolve(ctx);
    return host.call('ls_context').then(function (r) {
      if (!r.ok) return ctx;
      var projChanged = !ctx.project || !r.project || ctx.project.path !== r.project.path;
      ctx.project = r.project; ctx.seq = r.seq; ctx.version = r.version;
      if (projChanged) loadProject();
      emit('ctx', ctx);
      return ctx;
    }).catch(function () { return ctx; });
  }

  function go(seconds) { return host.call('ls_setPlayer', seconds).catch(function () {}); }

  // ------------------------------------------------------------------ FFmpeg

  var tools = null;
  function locateTools() {
    var ff = R360.ffmpeg;
    tools = ff ? ff.locate(host.extensionDir(), settings.ffmpeg) : null;
    return tools;
  }
  function needTools() {
    if (!tools) throw new Error('FFmpeg introuvable : relance Install-Windows.bat (ou Réglages › FFmpeg).');
    return tools;
  }

  // ------------------------------------------------------------------ UI helpers

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast on ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, kind === 'err' ? 6000 : 3200);
  }

  // Runs fn() (returning a promise) with the button disabled; errors become a red toast.
  function busy(btn, fn) {
    if (btn.classList.contains('busy')) return Promise.resolve();
    btn.classList.add('busy');
    var label = btn.textContent;
    return Promise.resolve().then(fn).catch(function (e) {
      if (e && e.message !== 'CANCELLED') toast(e.message || String(e), 'err');
    }).then(function () { btn.classList.remove('busy'); btn.textContent = label; });
  }

  function modal(title, hint, text, okLabel) {
    return new Promise(function (resolve) {
      $('modalTitle').textContent = title;
      $('modalHint').textContent = hint || '';
      $('modalText').value = text || '';
      $('modalOk').textContent = okLabel || 'Importer';
      $('modal').classList.add('on');
      setTimeout(function () { $('modalText').focus(); }, 30);
      function done(v) {
        $('modal').classList.remove('on');
        $('modalOk').onclick = $('modalCancel').onclick = null;
        resolve(v);
      }
      $('modalOk').onclick = function () { done($('modalText').value); };
      $('modalCancel').onclick = function () { done(null); };
    });
  }

  function copy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copié dans le presse-papiers.', 'ok'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function pickFile(title, types) { return host.openFileDialog(title, types); }

  // Canvas sized to its CSS box at device resolution.
  function fitCanvas(c) {
    var d = Math.min(2, root.devicePixelRatio || 1), w = Math.max(2, Math.round(c.clientWidth * d)), h = Math.max(2, Math.round(c.clientHeight * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return d;
  }

  root.LS = root.LS || {};
  root.LS.app = {
    host: host, core: core, fs: fs, path: path, os: os, $: $, esc: esc, clone: clone,
    settings: settings, saveSettings: saveSettings, LABELS: LABELS, MARKER: MARKER,
    ctx: ctx, get project() { return project; }, saveProject: saveProject, projectWorkDir: projectWorkDir, dataDir: dataDir,
    on: on, emit: emit, run: run, refreshContext: refreshContext, go: go,
    locateTools: locateTools, needTools: needTools, get tools() { return tools; },
    toast: toast, busy: busy, modal: modal, copy: copy, pickFile: pickFile, fitCanvas: fitCanvas,
    pages: {}
  };
})(window);
