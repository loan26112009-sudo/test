/*
 * Structure: planned segments (target durations + emotion), open loops, retention map,
 * two-way sync with the timeline through [SEG] / [LOOP] / [MK] sequence markers,
 * placeholders for missing shots and YouTube chapters.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var EMOTIONS = ['Curiosité', 'Tension', 'Malaise', 'Comique', 'Plaisir', 'Surprise', 'Empathie', 'Peur', 'Espoir', 'Joie', 'Mélancolie', 'Nostalgie', 'Catharsis', 'Satisfaction'];
  var PREFIX = { seg: '[SEG] ', loop: '[LOOP] ', mk: '[MK] ' };
  var mapState = { duration: 0 };

  function P() {
    var p = A.project;
    p.segments = p.segments || [];
    p.loops = p.loops || [];
    p.lbMarkers = p.lbMarkers || [];
    return p;
  }

  // Segment positions: from the timeline when known (after "Lire depuis la timeline"), else planned.
  function placedSegments() {
    var segs = P().segments, t = 0;
    return segs.map(function (s) {
      var start = typeof s.start === 'number' ? s.start : t;
      t = start + (s.duration || 0);
      return Object.assign({}, s, { start: start, end: start + (s.duration || 0) });
    });
  }

  function totalPlanned() { return P().segments.reduce(function (a, s) { return a + (s.duration || 0); }, 0); }

  function timeInput(v, onChange, cls) {
    var i = document.createElement('input');
    i.type = 'text'; i.className = cls || 'time'; i.value = v ? core.fmtTime(v) : '';
    i.placeholder = '0:00';
    i.addEventListener('change', function () {
      var t = core.parseTime(i.value);
      if (isNaN(t)) { i.value = ''; t = 0; } else i.value = core.fmtTime(t);
      onChange(t);
    });
    return i;
  }
  function textInput(v, onChange, list) {
    var i = document.createElement('input');
    i.type = 'text'; i.value = v || '';
    if (list) i.setAttribute('list', list);
    i.addEventListener('change', function () { onChange(i.value.trim()); });
    return i;
  }
  function delBtn(fn) {
    var td = document.createElement('td'), b = document.createElement('button');
    td.className = 'x'; b.textContent = '✕'; b.title = 'Supprimer'; b.addEventListener('click', fn); td.appendChild(b);
    return td;
  }
  function cell(el, cls) { var td = document.createElement('td'); if (cls) td.className = cls; td.appendChild(el); return td; }

  function renderSegments() {
    var tb = $('sSegs').querySelector('tbody'), p = P();
    tb.innerHTML = '';
    p.segments.forEach(function (s, i) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(textInput(s.name, function (v) { s.name = v; changed(); })));
      tr.appendChild(cell(timeInput(s.duration, function (v) { s.duration = v; changed(); }), 'w-dur'));
      tr.appendChild(cell(textInput(s.emotion, function (v) { s.emotion = v; changed(); }, 'emotions'), 'w-emo'));
      tr.appendChild(delBtn(function () { p.segments.splice(i, 1); changed(true); }));
      tb.appendChild(tr);
    });
    if (!p.segments.length) tb.innerHTML = '<tr><td colspan="4" class="hint">Ajoute tes segments (Intro, Phase 1…) ou importe ta structure / ton export Loop Builder.</td></tr>';
    $('sTarget').value = p.target ? core.fmtTime(p.target) : '';
    renderTotal();
  }

  function renderTotal() {
    var p = P(), tot = totalPlanned(), txt = 'Total prévu ' + core.fmtTime(tot);
    if (p.target) {
      var d = tot - p.target;
      txt += Math.abs(d) < 1 ? ' · pile la cible ✓' : ' · ' + (d > 0 ? '+' : '−') + core.fmtTime(Math.abs(d)) + (d > 0 ? ' au-dessus' : ' en dessous');
    }
    if (A.ctx.seq) txt += ' · timeline ' + core.fmtTime(A.ctx.seq.duration);
    $('sTotal').textContent = txt;
  }

  function renderLoops() {
    var tb = $('sLoops').querySelector('tbody'), p = P();
    tb.innerHTML = '';
    p.loops.forEach(function (l, i) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(textInput(l.label, function (v) { l.label = v; changed(); })));
      tr.appendChild(cell(timeInput(l.start, function (v) { l.start = v; changed(); }), 'w-dur'));
      tr.appendChild(cell(timeInput(l.end, function (v) { l.end = v; changed(); }), 'w-dur'));
      tr.appendChild(delBtn(function () { p.loops.splice(i, 1); changed(true); }));
      tb.appendChild(tr);
    });
    if (!p.loops.length) tb.innerHTML = '<tr><td colspan="4" class="hint">Une boucle = une question que le spectateur se pose (« va-t-il tenir ? »), du moment où elle s\'ouvre à celui où elle se ferme.</td></tr>';
  }

  function changed(rerenderTables) {
    A.saveProject();
    if (rerenderTables) { renderSegments(); renderLoops(); }
    renderTotal(); renderMap(); renderChapters();
  }

  // ------------------------------------------------------------------ retention map

  function analysis() {
    var p = P(), segs = placedSegments();
    var D = Math.max(A.ctx.seq ? A.ctx.seq.duration : 0, totalPlanned(), p.target || 0,
      p.loops.reduce(function (a, l) { return Math.max(a, l.end || 0); }, 0), 1);
    var loops = p.loops.filter(function (l) { return l.end > l.start; });
    var ret = core.retention(loops, D, { step: Math.max(0.5, D / 600), minGap: 8, maxOpen: 3 });
    var issues = loops.length ? ret.issues.slice() : [];
    core.emotionIssues(segs).forEach(function (e) { issues.push({ type: 'emotion', start: segs[e.index].start, end: segs[e.index].end, text: e.text }); });
    if (p.target && totalPlanned() > 0) {
      var d = totalPlanned() - p.target;
      if (Math.abs(d) > p.target * 0.1) issues.push({ type: 'duration', start: 0, end: 0, text: 'Durée prévue ' + core.fmtTime(totalPlanned()) + ' pour une cible de ' + core.fmtTime(p.target) + ' (' + (d > 0 ? '+' : '') + Math.round(d / p.target * 100) + ' %)' });
    }
    if (A.ctx.seq && p.target && A.ctx.seq.duration > p.target * 1.15) issues.push({ type: 'duration', start: 0, end: 0, text: 'La timeline fait ' + core.fmtTime(A.ctx.seq.duration) + ' : ' + core.fmtTime(A.ctx.seq.duration - p.target) + ' de plus que la cible.' });
    return { D: D, segs: segs, loops: loops, samples: ret.samples, issues: issues.sort(function (a, b) { return a.start - b.start; }) };
  }

  function renderMap() {
    var c = $('sMap');
    if (!c.clientWidth) return;
    var d = A.fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height, an = analysis(), D = an.D;
    mapState.duration = D;
    var X = function (t) { return 6 * d + (t / D) * (W - 12 * d); };
    g.clearRect(0, 0, W, H);
    var segH = 18 * d, cols = ['#2c4a7a', '#3b2c6e', '#2c5a5a', '#5a3b2c', '#2c5a3b', '#5a2c4a'];
    an.segs.forEach(function (s, i) {
      if (!s.duration) return;
      g.fillStyle = cols[i % cols.length]; g.fillRect(X(s.start), 0, Math.max(1, X(s.end) - X(s.start)) - 1, segH);
      g.save(); g.beginPath(); g.rect(X(s.start), 0, X(s.end) - X(s.start) - 2, segH); g.clip();
      g.fillStyle = '#dfe6f5'; g.font = (10 * d) + 'px Segoe UI, sans-serif'; g.textBaseline = 'middle';
      g.fillText(s.name, X(s.start) + 4 * d, segH / 2); g.restore();
    });
    // loops as stacked bars
    var rows = [], top = segH + 4 * d, rowH = 5 * d;
    an.loops.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (l) {
      var r = 0; while (rows[r] !== undefined && rows[r] > l.start) r++;
      rows[r] = l.end;
      if (r > 7) return;
      g.fillStyle = l.level === 'macro' ? '#8b5cf6' : 'rgba(139,92,246,.65)';
      g.fillRect(X(l.start), top + r * (rowH + 2 * d), Math.max(2, X(l.end) - X(l.start)), rowH);
    });
    // open-loop count (step chart) with the 1–3 comfort band
    var base = H - 4 * d, unit = Math.min(9 * d, (base - (top + Math.min(rows.length, 8) * (rowH + 2 * d)) - 4 * d) / 4);
    g.fillStyle = 'rgba(47,210,122,.08)'; g.fillRect(X(0), base - 3 * unit, X(D) - X(0), 2 * unit);
    an.issues.forEach(function (is) {
      if (!(is.end > is.start)) return;
      g.fillStyle = is.type === 'none' ? 'rgba(255,90,90,.28)' : 'rgba(255,176,32,.22)';
      g.fillRect(X(is.start), top, X(is.end) - X(is.start), base - top);
    });
    if (an.loops.length) {
      g.strokeStyle = '#2fd27a'; g.lineWidth = 1.5 * d; g.beginPath();
      an.samples.forEach(function (s, i) {
        var y = base - Math.min(4, s.open) * unit;
        if (!i) g.moveTo(X(s.t), y); else { g.lineTo(X(s.t), g.__lastY); g.lineTo(X(s.t), y); }
        g.__lastY = y;
      });
      g.stroke();
    }
    if (A.ctx.seq) {
      var px = X(Math.min(D, A.ctx.seq.player));
      g.strokeStyle = '#3d8bff'; g.lineWidth = 2 * d; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
    }
    var ul = $('sIssues');
    ul.innerHTML = '';
    if (!an.issues.length) {
      ul.innerHTML = an.loops.length || an.segs.length ? '<li class="ok">Rétention OK : toujours 1 à 3 boucles ouvertes, émotions contrastées.</li>' : '';
      return;
    }
    an.issues.forEach(function (is) {
      var li = document.createElement('li');
      li.className = is.type === 'none' ? 'bad' : '';
      li.innerHTML = (is.end > is.start ? '<span class="tc">' + core.fmtTime(is.start) + '–' + core.fmtTime(is.end) + '</span>' : '') + A.esc(is.text);
      if (is.end > is.start) li.addEventListener('click', function () { A.go(is.start); });
      ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------------ timeline sync

  function push() {
    var p = P(), list = [];
    placedSegments().forEach(function (s) {
      if (s.name) list.push({ t: s.start, end: s.duration ? s.end : 0, name: PREFIX.seg + s.name, comment: s.emotion || '', color: A.MARKER.blue });
    });
    p.loops.forEach(function (l) { if (l.label) list.push({ t: l.start || 0, end: l.end > l.start ? l.end : 0, name: PREFIX.loop + l.label, comment: l.level || '', color: A.MARKER.purple }); });
    p.lbMarkers.forEach(function (m) { list.push({ t: m.t, end: 0, name: PREFIX.mk + m.label, comment: '', color: A.MARKER.yellow }); });
    if (!list.length) return Promise.reject(new Error('Rien à poser : ajoute des segments ou des boucles.'));
    return A.run('ls_syncSeqMarkers', [PREFIX.seg.trim(), PREFIX.loop.trim(), PREFIX.mk.trim()], list).then(function (r) {
      A.toast(r.created + ' marqueurs posés sur la timeline' + (r.removed ? ' (' + r.removed + ' anciens remplacés)' : '') + '. Déplace-les dans Premiere puis « Lire depuis la timeline ».', 'ok');
    });
  }

  function pull() {
    return A.run('ls_seqMarkers').then(function (r) {
      var p = P(), ms = r.markers, segs = [], loops = [], mks = [];
      ms.forEach(function (m) {
        var name = m.name || '';
        if (name.indexOf('[SEG]') === 0) segs.push({ name: name.slice(5).trim(), start: m.start, end: m.end, emotion: m.comment || '' });
        else if (name.indexOf('[LOOP]') === 0) loops.push({ label: name.slice(6).trim(), start: m.start, end: m.end > m.start ? m.end : m.start, level: m.comment === 'macro' ? 'macro' : 'micro' });
        else if (name.indexOf('[MK]') === 0) mks.push({ label: name.slice(4).trim(), t: m.start });
      });
      if (!segs.length && !loops.length) throw new Error('Aucun marqueur [SEG] ou [LOOP] dans la séquence.');
      segs.sort(function (a, b) { return a.start - b.start; });
      segs.forEach(function (s, i) {
        var next = segs[i + 1] ? segs[i + 1].start : (r.seq ? r.seq.duration : s.end);
        s.duration = s.end > s.start ? s.end - s.start : Math.max(0, next - s.start);
        delete s.end;
      });
      if (segs.length) p.segments = segs;
      if (loops.length) p.loops = loops;
      p.lbMarkers = mks;
      A.saveProject(); renderSegments(); renderLoops(); renderMap(); renderChapters();
      A.toast('Structure relue depuis la timeline : ' + segs.length + ' segment(s), ' + loops.length + ' boucle(s).', 'ok');
    });
  }

  function importText() {
    return A.modal('Importer une structure', 'Colle l\'export de Loop Builder (« Exporter les notes ») ou une ligne par segment : « Intro | 0:45 | Curiosité ».', '').then(function (txt) {
      if (!txt || !txt.trim()) return;
      var p = P();
      if (/BOUCLES|SOUS-BOUCLES|LOOP BUILDER/i.test(txt)) {
        var lb = core.parseLoopBuilder(txt);
        p.loops = lb.loops; p.lbMarkers = lb.markers;
        if (lb.duration > 0) p.target = lb.duration;
        A.toast('Loop Builder importé : ' + lb.loops.length + ' boucle(s), ' + lb.markers.length + ' marqueur(s).', 'ok');
      } else {
        var segs = core.parseSegments(txt);
        if (!segs.length) throw new Error('Aucun segment reconnu.');
        p.segments = segs;
        A.toast(segs.length + ' segment(s) importé(s).', 'ok');
      }
      changed(true);
    });
  }

  // ------------------------------------------------------------------ placeholders

  function placeholder() {
    var name = $('phName').value.trim(), secs = +$('phDur').value;
    if (!name) { $('phName').focus(); throw new Error('Donne un nom au placeholder (ex : MANETTE).'); }
    if (!(secs > 0)) throw new Error('Durée invalide.');
    var t = A.needTools(), seq = A.ctx.seq;
    if (!seq) throw new Error('Ouvre la séquence de montage.');
    var dir = A.projectWorkDir('Placeholders');
    if (!dir) throw new Error('Enregistre d\'abord ton projet Premiere (Fichier › Enregistrer).');
    R360.ffmpeg.mkdirp(dir);
    var file = A.path.join(dir, 'PLACEHOLDER_' + name.replace(/[<>:"\/\\|?*\x00-\x1f]+/g, '').replace(/\s+/g, '_') + '_' + Date.now().toString(36) + '.mp4');
    var fps = seq.fps > 0 ? seq.fps.toFixed(4) : '30';
    return R360.ffmpeg.makePlaceholder(t, { out: file, name: name, seconds: secs, width: seq.width, height: seq.height, fps: fps, note: $('phNote').value.trim() || null })
      .then(function () { return A.run('ls_placeFile', { path: file, bin: 'PLACEHOLDERS', seconds: secs, at: null, track: -1, label: 6 }); })
      .then(function (r) {
        A.toast('🧩 « ' + name + ' » posé sur V' + (r.track + 1) + ' à ' + core.fmtTime(r.at) + '. La Vérif finale le signalera tant qu\'il reste.', 'ok');
        $('phName').value = ''; $('phNote').value = '';
      });
  }

  // ------------------------------------------------------------------ chapters

  function renderChapters() {
    var segs = placedSegments().filter(function (s) { return s.name; });
    if (!segs.length) { $('chText').value = ''; $('chWarn').innerHTML = '<li class="ok">Les chapitres se génèrent à partir de tes segments.</li>'; return; }
    var c = core.chapters(segs.map(function (s) { return { name: s.name, start: s.start }; }));
    $('chText').value = c.text;
    $('chWarn').innerHTML = c.warnings.map(function (w) { return '<li>' + A.esc(w) + '</li>'; }).join('');
  }

  function init() {
    var dl = document.createElement('datalist'); dl.id = 'emotions';
    dl.innerHTML = EMOTIONS.map(function (e) { return '<option value="' + e + '">'; }).join('');
    document.body.appendChild(dl);
    $('sAddSeg').addEventListener('click', function () { P().segments.push({ name: 'Segment ' + (P().segments.length + 1), duration: 60, emotion: '' }); changed(true); });
    $('sAddLoop').addEventListener('click', function () { var s = A.ctx.seq ? A.ctx.seq.player : 0; P().loops.push({ label: 'Nouvelle boucle', start: s, end: s + 60, level: 'micro' }); changed(true); });
    $('sTarget').addEventListener('change', function () { var t = core.parseTime(this.value); P().target = isNaN(t) ? 0 : t; this.value = P().target ? core.fmtTime(P().target) : ''; changed(); });
    $('sImport').addEventListener('click', function () { importText().catch(function (e) { A.toast(e.message, 'err'); }); });
    $('sPush').addEventListener('click', function () { A.busy(this, push); });
    $('sPull').addEventListener('click', function () { A.busy(this, pull); });
    $('phMake').addEventListener('click', function () { A.busy(this, placeholder); });
    $('chCopy').addEventListener('click', function () { if ($('chText').value) A.copy($('chText').value); });
    $('sMap').addEventListener('click', function (e) {
      var r = this.getBoundingClientRect(), t = (e.clientX - r.left - 6) / (r.width - 12) * mapState.duration;
      if (t >= 0) A.go(t).then(function () { return A.refreshContext(); });
    });
    A.on('project', function () { renderSegments(); renderLoops(); renderChapters(); renderMap(); });
    A.on('ctx', function () { if (A.pages.current === 'structure') { renderTotal(); renderMap(); } });
    root.addEventListener('resize', function () { if (A.pages.current === 'structure') renderMap(); });
  }

  function show() { renderTotal(); renderMap(); }

  A.pages.structure = { init: init, show: show, push: push, pull: pull };
})(window);
