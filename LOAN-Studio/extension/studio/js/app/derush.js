/*
 * Dérush: rate the clip open in the Source Monitor A / B / C (Premiere label colours), drop ⭐ moments
 * and notes as clip markers, jump to the next unrated clip, then build the SÉLECTS and ⭐ TOP bins.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var S = { item: null, from: '', position: null, clips: [], speed: 0, poll: null, visible: false };
  // the dérush is about camera rushes: sounds, music and stills stay out of the queue
  var NOT_RUSH = /\.(wav|mp3|aac|m4a|aif|aiff|flac|ogg|png|jpe?g|tiff?|psd|gif|bmp|ai|svg|mogrt)$/i;

  function rateOf(label) {
    var s = A.settings;
    return label === s.labelA ? 'A' : label === s.labelB ? 'B' : label === s.labelC ? 'C' : '';
  }
  function labelFor(r) { return A.settings['label' + r]; }

  function renderItem() {
    var it = S.item;
    Array.prototype.forEach.call(document.querySelectorAll('.rate[data-rate]'), function (b) { b.classList.toggle('on', !!it && rateOf(it.label) === b.getAttribute('data-rate')); });
    if (!it) {
      $('dClipName').textContent = 'Ouvre un rush dans le moniteur Source (double-clic dans le panneau Projet)';
      $('dClipMeta').textContent = ''; $('dClipFrom').textContent = '';
      return;
    }
    $('dClipName').textContent = it.name;
    var tops = (it.markers || []).filter(function (m) { return m.name && m.name.charAt(0) === '⭐'; });
    $('dClipMeta').textContent = (it.bin ? it.bin + ' · ' : '') + (it.markers ? it.markers.length + ' marqueur(s), ' + tops.length + ' ⭐' : '') +
      (S.position !== null ? ' · Source à ' + core.fmtTime(S.position) : '');
    $('dClipFrom').textContent = S.from === 'source' ? 'moniteur Source' : 'sélection du projet';
  }

  function refreshSource() {
    if (!A.host.inPremiere) return Promise.resolve();
    return A.run('ls_source').then(function (r) {
      var prev = S.item && S.item.nodeId;
      S.item = r.item; S.from = r.from; S.position = r.position;
      if (S.item) {
        var c = find(S.item.nodeId);
        if (c) { S.item.bin = c.bin; c.label = S.item.label; }
      }
      renderItem();
      if (prev !== (S.item && S.item.nodeId)) renderList();
    }).catch(function () {});
  }

  function find(nodeId) { for (var i = 0; i < S.clips.length; i++) if (S.clips[i].nodeId === nodeId) return S.clips[i]; return null; }

  function loadClips() {
    return A.run('ls_listClips', true).then(function (r) {
      S.clips = r.clips;
      var scope = $('dScope'), cur = scope.value, bins = {};
      S.clips.forEach(function (c) { if (c.bin) { var parts = c.bin.split(' / '); for (var i = 1; i <= parts.length; i++) bins[parts.slice(0, i).join(' / ')] = 1; } });
      scope.innerHTML = '<option value="">Tout le projet</option>' + Object.keys(bins).sort().filter(function (b) { return !/^(SÉLECTS|⭐ TOP|PLACEHOLDERS|✂ JUMP-CUTS|Reframe 360)/.test(b); })
        .map(function (b) { return '<option value="' + A.esc(b) + '">' + A.esc(b) + '</option>'; }).join('');
      if (cur && bins[cur]) scope.value = cur;
      renderList();
    });
  }

  function inScope(c) {
    var s = $('dScope').value;
    if (/^(SÉLECTS|⭐ TOP|PLACEHOLDERS|✂ JUMP-CUTS|Reframe 360)/.test(c.bin) || NOT_RUSH.test(c.mediaPath)) return false;
    return !s || c.bin === s || c.bin.indexOf(s + ' / ') === 0;
  }
  function matches(c) {
    var f = $('dFilter').value, r = rateOf(c.label);
    if (f === 'todo') return !r;
    if (f === 'top') return c.top && c.top.length;
    if (f === 'all') return true;
    return r === f;
  }
  function queue() { return S.clips.filter(function (c) { return inScope(c) && matches(c); }); }

  function renderList() {
    var scoped = S.clips.filter(inScope), rated = scoped.filter(function (c) { return rateOf(c.label); }).length;
    $('dProgress').textContent = rated + ' / ' + scoped.length + ' notés';
    $('dBar').style.width = (scoped.length ? rated / scoped.length * 100 : 0) + '%';
    var ul = $('dList'), q = queue();
    ul.innerHTML = '';
    if (!q.length) { ul.innerHTML = '<li class="hint">' + (scoped.length ? 'Rien dans ce filtre. 🎉' : 'Aucun clip vidéo dans le projet.') + '</li>'; return; }
    q.slice(0, 400).forEach(function (c) {
      var li = document.createElement('li');
      if (S.item && S.item.nodeId === c.nodeId) li.className = 'cur';
      var col = c.label >= 0 && A.LABELS[c.label] ? A.LABELS[c.label][1] : '#555';
      li.innerHTML = '<span class="dot" style="background:' + col + '"></span><span class="nm">' + A.esc(c.name) + '</span>' +
        '<span class="meta">' + (rateOf(c.label) || '') + (c.top && c.top.length ? ' · ' + c.top.length + '⭐' : '') + '</span>';
      li.title = c.bin;
      li.addEventListener('click', function () { open(c); });
      ul.appendChild(li);
    });
  }

  function open(c) {
    return A.run('ls_openSource', c.nodeId).then(function () {
      if (S.speed > 0) return A.run('ls_playSource', S.speed);
    }).then(refreshSource).catch(function (e) { A.toast(e.message, 'err'); });
  }

  function step(dir) {
    var q = queue(), i = -1;
    if (S.item) for (var k = 0; k < q.length; k++) if (q[k].nodeId === S.item.nodeId) i = k;
    // in the "non notés" filter the current clip leaves the list once rated: next = first after it
    if (i < 0 && S.item && dir > 0) {
      var all = S.clips.filter(inScope), pos = all.indexOf(find(S.item.nodeId));
      for (var j = pos + 1; j < all.length; j++) if (matches(all[j])) return open(all[j]);
    }
    var n = q[i + dir] || (dir > 0 ? q[0] : null);
    if (!n || (S.item && n.nodeId === S.item.nodeId)) { A.toast('Fin de la file. ' + (dir > 0 ? 'Tout est noté dans ce filtre 🎉' : ''), 'ok'); return Promise.resolve(); }
    return open(n);
  }

  function rate(r) {
    if (!S.item) return A.toast('Ouvre d\'abord un clip dans le moniteur Source.', 'err');
    var it = S.item;
    return A.run('ls_rate', it.nodeId, labelFor(r)).then(function (res) {
      it.label = res.label;
      var c = find(it.nodeId); if (c) c.label = res.label;
      renderItem(); renderList();
      A.toast(r + ' → ' + it.name, 'ok');
      if ($('dAuto').checked) return step(1);
    }).catch(function (e) { A.toast(e.message, 'err'); });
  }

  function marker(name, comment, color) {
    if (!S.item) return Promise.reject(new Error('Ouvre d\'abord un clip dans le moniteur Source.'));
    if (S.from !== 'source') return Promise.reject(new Error('Ouvre le clip dans le moniteur Source pour placer un marqueur à la bonne image.'));
    return A.run('ls_clipMarker', S.item.nodeId, name, comment || '', color, null).then(function (r) {
      S.item.markers = r.markers;
      var c = find(S.item.nodeId);
      if (c) c.top = r.markers.filter(function (m) { return m.name.charAt(0) === '⭐'; });
      renderItem(); renderList();
      A.toast('Marqueur « ' + name + ' » à ' + core.fmtTime(r.start), 'ok');
    });
  }

  function addTop() {
    var note = $('dNote').value.trim();
    return marker('⭐ ' + (note || 'TOP'), note, A.MARKER.yellow).then(function () { $('dNote').value = ''; }).catch(function (e) { A.toast(e.message, 'err'); });
  }
  function addNote() {
    var note = $('dNote').value.trim();
    if (!note) return $('dNote').focus();
    return marker(note, '', A.MARKER.green).then(function () { $('dNote').value = ''; }).catch(function (e) { A.toast(e.message, 'err'); });
  }

  function makeSelects() {
    var labels = [labelFor('A')];
    if ($('dIncludeB').checked) labels.push(labelFor('B'));
    A.settings.top = { before: +$('dTopBefore').value || 0, after: +$('dTopAfter').value || 0 };
    A.settings.includeB = $('dIncludeB').checked; A.saveSettings();
    return A.run('ls_makeSelects', { labels: labels, binName: 'SÉLECTS', top: { enabled: true, before: A.settings.top.before, after: A.settings.top.after, binName: '⭐ TOP' } }).then(function (r) {
      A.toast('SÉLECTS : ' + r.selects + ' clip(s) · ⭐ TOP : ' + r.tops + ' moment(s)' + (r.skipped ? ' · ' + r.skipped + ' déjà présent(s)' : '') + (r.failed ? ' · ⚠ ' + r.failed + ' échec(s)' : ''), r.failed ? 'err' : 'ok');
      var p = A.project; p.golden = p.golden || {};
      if (!p.golden.derush && S.clips.filter(inScope).every(function (c) { return rateOf(c.label); })) { p.golden.derush = true; A.saveProject(); A.emit('project', p); }
      return loadClips();
    });
  }

  function copyTop() {
    var lines = [];
    S.clips.forEach(function (c) { (c.top || []).forEach(function (m) { lines.push(c.name + ' — ' + core.fmtTime(m.start) + ' — ' + m.name.replace(/^⭐\s*/, '')); }); });
    if (!lines.length) return A.toast('Aucun moment ⭐ pour l\'instant.', 'err');
    A.copy('⭐ MEILLEURS PLANS (' + lines.length + ')\n' + lines.join('\n'));
  }

  function key(e) {
    var k = e.key.toLowerCase();
    if (k === '1') rate('A'); else if (k === '2') rate('B'); else if (k === '3') rate('C');
    else if (k === '4' || k === 't') addTop();
    else if (k === 'n') { $('dNote').focus(); }
    else if (k === 's' || e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else return false;
    return true;
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.rate[data-rate]'), function (b) { b.addEventListener('click', function () { rate(b.getAttribute('data-rate')); }); });
    $('dTop').addEventListener('click', addTop);
    $('dNoteBtn').addEventListener('click', addNote);
    $('dNote').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
    $('dRefresh').addEventListener('click', function () { A.busy(this, function () { return loadClips().then(refreshSource); }); });
    $('dNext').addEventListener('click', function () { step(1); });
    Array.prototype.forEach.call(document.querySelectorAll('.speeds [data-speed]'), function (b) {
      b.addEventListener('click', function () {
        S.speed = +b.getAttribute('data-speed');
        A.run('ls_playSource', S.speed).catch(function (e) { A.toast(e.message, 'err'); });
      });
    });
    $('dScope').addEventListener('change', renderList);
    $('dFilter').addEventListener('change', renderList);
    $('dMakeSelects').addEventListener('click', function () { A.busy(this, makeSelects); });
    $('dCopyTop').addEventListener('click', copyTop);
    $('dAuto').checked = A.settings.autoNext !== false;
    $('dAuto').addEventListener('change', function () { A.settings.autoNext = this.checked; A.saveSettings(); });
    $('dIncludeB').checked = !!A.settings.includeB;
    $('dTopBefore').value = A.settings.top.before; $('dTopAfter').value = A.settings.top.after;
    renderItem();
  }

  function show() {
    S.visible = true;
    loadClips().then(refreshSource).catch(function (e) { A.toast(e.message, 'err'); });
    clearInterval(S.poll);
    S.poll = setInterval(function () { if (S.visible && !document.hidden) refreshSource(); }, 1500);
  }
  function hide() { S.visible = false; clearInterval(S.poll); }

  A.pages.derush = { init: init, show: show, hide: hide, key: key, state: S };
})(window);
