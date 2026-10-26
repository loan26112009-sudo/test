/*
 * LOAN Studio — panel controller: navigation, Premiere context, keyboard, settings, diagnostic.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, host = A.host, $ = A.$;
  var pages = A.pages;

  // ------------------------------------------------------------------ navigation

  function show(name) {
    if (name === 'r360') { /* page shown, panel opened from the button */ }
    var prev = pages.current;
    if (prev && pages[prev] && pages[prev].hide) pages[prev].hide();
    pages.current = name;
    Array.prototype.forEach.call(document.querySelectorAll('.rail button'), function (b) { b.classList.toggle('on', b.getAttribute('data-page') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) { p.classList.toggle('on', p.id === 'page-' + name); });
    try { localStorage.setItem('ls.page', name); } catch (e) {}
    if (pages[name] && pages[name].show) pages[name].show();
  }

  // ------------------------------------------------------------------ context header

  function renderCtx() {
    var c = A.ctx;
    if (!host.inPremiere) {
      $('ctxSeq').textContent = 'Mode aperçu';
      $('ctxSub').textContent = 'Ouvre ce panneau dans Premiere : Fenêtre › Extensions › LOAN Studio';
      return;
    }
    $('ctxSeq').textContent = c.seq ? c.seq.name : 'Aucune séquence ouverte';
    $('ctxSub').textContent = (c.project ? c.project.name.replace(/\.prproj$/i, '') : '') +
      (c.seq ? ' · ' + core.fmtTime(c.seq.duration) + ' · tête à ' + core.fmtTime(c.seq.player) : '');
  }

  // ------------------------------------------------------------------ settings page

  function initSettings() {
    Array.prototype.forEach.call(document.querySelectorAll('.labelSel'), function (sel) {
      var k = sel.getAttribute('data-k');
      sel.innerHTML = A.LABELS.map(function (l, i) { return '<option value="' + i + '">' + l[0] + '</option>'; }).join('');
      sel.value = String(A.settings[k]);
      sel.addEventListener('change', function () { A.settings[k] = +sel.value; A.saveSettings(); });
    });
    $('setBackupDir').textContent = A.settings.backupDir || 'À côté du projet / Backups LOAN';
    $('setBackupBtn').addEventListener('click', function () {
      var d = host.chooseFolder('Dossier des copies de secours (ex : disque externe)');
      A.settings.backupDir = d || ''; A.saveSettings();
      $('setBackupDir').textContent = d || 'À côté du projet / Backups LOAN';
    });
    $('setHw').checked = A.settings.hw !== false;
    $('setHw').addEventListener('change', function () { A.settings.hw = this.checked; A.saveSettings(); });
    $('diagCopy').addEventListener('click', function () { A.copy($('diag').textContent); });
  }

  function diagnostic() {
    var t = A.tools, proc = host.process;
    var lines = [
      'LOAN Studio 2.0.0',
      'Panneau : ' + (host.inPremiere ? 'Premiere Pro (CEP)' : 'navigateur (aperçu)') + ' · ' + ((navigator.userAgent.match(/Chrome\/[\d.]+/) || ['?'])[0]),
      'Node.js : ' + (proc ? proc.versions.node + ' · ' + proc.platform + ' ' + proc.arch : 'non disponible'),
      'FFmpeg : ' + (t ? t.ffmpeg : 'introuvable'),
      'Données : ' + (A.fs ? A.dataDir() : 'localStorage'),
      'Extension : ' + host.extensionDir()
    ];
    $('diag').textContent = lines.join('\n');
    $('setFF').textContent = t ? t.ffmpeg : 'Introuvable — relance Install-Windows.bat';
    if (host.inPremiere) host.call('ls_context').then(function (r) { if (r.ok) $('diag').textContent += '\nPremiere Pro : ' + r.version; }).catch(function () {});
    if (t) R360.ffmpeg.version(t).then(function (v) { $('diag').textContent += '\n' + v; }).catch(function (e) { $('diag').textContent += '\nFFmpeg ne démarre pas : ' + e.message; });
  }

  // ------------------------------------------------------------------ keyboard

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button');
    if (b) b.blur();
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target || {}, tag = t.tagName || '', type = (t.type || '').toLowerCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && type !== 'checkbox' && type !== 'range')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if ($('modal').classList.contains('on') || e.ctrlKey || e.metaKey || e.altKey) return;
    var p = pages[pages.current];
    if (p && p.key && p.key(e)) e.preventDefault();
  });

  // ------------------------------------------------------------------ init

  Array.prototype.forEach.call(document.querySelectorAll('.rail button'), function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-page')); });
  });
  $('btnSettings').addEventListener('click', function () { show(pages.current === 'settings' ? 'home' : 'settings'); diagnostic(); });
  $('btnRefresh').addEventListener('click', function () {
    A.busy(this, function () { return A.refreshContext().then(function () { if (pages[pages.current] && pages[pages.current].show) pages[pages.current].show(); A.toast('Actualisé.', 'ok'); }); });
  });
  $('rOpen').addEventListener('click', function () {
    if (!host.inPremiere) return A.toast('Disponible dans Premiere.', 'err');
    host.openPanel('com.loanstudio.reframe360');
  });

  host.registerKeys('studio');
  A.locateTools();
  ['home', 'derush', 'structure', 'blancs', 'audio', 'short', 'proxies', 'verif'].forEach(function (n) { pages[n].init(); });
  initSettings();
  A.on('ctx', renderCtx);
  renderCtx();

  var start = 'home';
  try { start = localStorage.getItem('ls.page') || 'home'; } catch (e) {}
  if (!$('page-' + start)) start = 'home';

  A.refreshContext().then(function () {
    if (!host.inPremiere) A.emit('project', A.project);
    show(start);
    diagnostic();
    if (!A.tools) A.toast('FFmpeg introuvable : relance Install-Windows.bat (certains outils en ont besoin).', 'err');
  });
  // keep the header (sequence, playhead) and the open page in sync with Premiere
  setInterval(function () { if (!document.hidden && host.inPremiere) A.refreshContext(); }, 2500);
  if (!host.inPremiere) setTimeout(function () { A.emit('project', A.project); }, 0);
})(window);
