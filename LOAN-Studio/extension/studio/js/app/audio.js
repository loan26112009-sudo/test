/*
 * Audio: per-role clip gains (Loan's mix: VO −6 dB, music −18 dB, SFX −12 dB peaks) and the
 * EBU R128 loudness check of the exported file (YouTube: −14 LUFS, true peak ≤ −1 dBTP).
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var ROLES = [['vo', 'Voix off'], ['mu', 'Musique'], ['fx', 'SFX'], ['', 'Ignorer']];
  var S = { tracks: [], plan: [], loud: null };

  function role(i) { var r = A.settings.roles[i]; return r === undefined ? (i < 3 ? ['vo', 'mu', 'fx'][i] : '') : r; }

  function loadTracks() {
    return A.run('ls_audioClips').then(function (r) {
      S.tracks = r.tracks;
      var tb = $('aTracks').querySelector('tbody');
      tb.innerHTML = '';
      r.tracks.forEach(function (t) {
        var tr = document.createElement('tr'), sel = document.createElement('select');
        sel.innerHTML = ROLES.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('');
        sel.value = role(t.index);
        sel.addEventListener('change', function () { A.settings.roles[t.index] = sel.value; A.saveSettings(); });
        tr.innerHTML = '<td>A' + (t.index + 1) + ' <small>' + A.esc(t.name || '') + '</small></td>';
        var td = document.createElement('td'); td.appendChild(sel); tr.appendChild(td);
        tr.insertAdjacentHTML('beforeend', '<td>' + t.clips.length + '</td>');
        tb.appendChild(tr);
      });
      if (!r.tracks.length) tb.innerHTML = '<tr><td colspan="3" class="hint">Aucune piste audio.</td></tr>';
    });
  }

  function analyze() {
    var t = A.needTools(), tg = A.settings.targets;
    tg.vo = +$('aVo').value; tg.mu = +$('aMu').value; tg.fx = +$('aFx').value; A.saveSettings();
    return loadTracks().then(function () {
      var jobs = [];
      S.tracks.forEach(function (tr) {
        var r = role(tr.index);
        if (!r) return;
        tr.clips.forEach(function (c) { if (c.mediaPath) jobs.push({ track: tr.index, role: r, clip: c }); });
      });
      if (!jobs.length) throw new Error('Aucun clip audio sur les pistes à régler.');
      S.plan = [];
      var i = 0, tb = $('aClips').querySelector('tbody');
      tb.innerHTML = '';
      $('aApply').disabled = true;
      function next() {
        if (i >= jobs.length) return Promise.resolve();
        var j = jobs[i++];
        $('aResult').textContent = 'Mesure ' + i + ' / ' + jobs.length + ' : ' + j.clip.name;
        return R360.ffmpeg.peaks(t, j.clip.mediaPath, j.clip.inPoint, j.clip.outPoint - j.clip.inPoint).then(function (pk) {
          var g = core.gainFor(pk.peak, tg[j.role]);
          var current = core.levelToDb(j.clip.level === null ? core.dbToLevel(0) : j.clip.level);
          var row = { track: j.track, nodeId: j.clip.nodeId, name: j.clip.name, role: j.role, peak: pk.peak, gain: g.gain, current: current, skip: j.clip.keyframed || g.silent, why: j.clip.keyframed ? 'keyframes de volume : ignoré' : g.silent ? 'silencieux' : g.clipped ? 'limité à +15 dB' : '' };
          S.plan.push(row);
          var tr = document.createElement('tr');
          if (row.skip || g.clipped) tr.className = 'warn';
          tr.innerHTML = '<td>' + A.esc(row.name) + ' <small>A' + (row.track + 1) + ' · ' + { vo: 'VO', mu: 'musique', fx: 'SFX' }[row.role] + '</small></td>' +
            '<td class="r">' + (isFinite(row.peak) ? row.peak.toFixed(1) + ' dB' : '—') + '</td>' +
            '<td class="r">' + (row.skip ? row.why : (row.gain > 0 ? '+' : '') + row.gain.toFixed(1) + ' dB' + (row.why ? ' <small>' + row.why + '</small>' : '')) + '</td>';
          tb.appendChild(tr);
        }).catch(function (e) {
          S.plan.push({ skip: true, name: j.clip.name, why: e.message });
        }).then(next);
      }
      return next().then(function () {
        var n = S.plan.filter(function (r) { return !r.skip; }).length;
        $('aResult').innerHTML = '<b>' + n + ' clip(s)</b> à régler : VO crête ' + tg.vo + ' dB · musique ' + tg.mu + ' dB · SFX ' + tg.fx + ' dB.';
        $('aApply').disabled = !n;
      });
    });
  }

  function apply() {
    var list = S.plan.filter(function (r) { return !r.skip; }).map(function (r) { return { track: r.track, nodeId: r.nodeId, level: core.dbToLevel(r.gain) }; });
    return A.run('ls_setLevels', list).then(function (r) {
      A.toast('🎚️ ' + r.done + ' clip(s) réglé(s)' + (r.missed ? ' · ' + r.missed + ' ignoré(s)' : '') + '. Annuler : Ctrl+Z dans Premiere.', 'ok');
      $('aApply').disabled = true;
    });
  }

  // ------------------------------------------------------------------ exported file loudness

  function loudnessVerdict(L) {
    var out = [];
    if (!isFinite(L.integrated)) return [{ cls: 'bad', text: 'Pas d\'audio mesurable.' }];
    if (L.integrated > -13) out.push({ cls: '', text: 'Trop fort (' + L.integrated.toFixed(1) + ' LUFS) : YouTube va baisser le volume et écraser la dynamique. Vise −14 à −16.' });
    else if (L.integrated < -17) out.push({ cls: '', text: 'Trop faible (' + L.integrated.toFixed(1) + ' LUFS) : ta vidéo sonnera moins fort que les autres. Vise −14 à −16.' });
    else out.push({ cls: 'ok', text: 'Loudness ' + L.integrated.toFixed(1) + ' LUFS : dans ta cible (−14 / −16) ✓' });
    if (L.truePeak > -1) out.push({ cls: 'bad', text: 'Crête ' + L.truePeak.toFixed(1) + ' dBTP : au-dessus de −1, risque de saturation après l\'encodage YouTube. Ajoute un limiteur à −1 dB sur le master.' });
    else out.push({ cls: 'ok', text: 'Crête ' + L.truePeak.toFixed(1) + ' dBTP ✓' });
    return out;
  }

  // Loud or near-silent stretches worth a listen.
  function zones(L) {
    var res = [], cur = null;
    L.series.forEach(function (p) {
      var k = p.s > -9 ? 'loud' : p.s < -32 ? 'quiet' : '';
      if (cur && cur.k === k) { cur.end = p.t; return; }
      if (cur && cur.k && cur.end - cur.start >= (cur.k === 'loud' ? 2 : 6)) res.push(cur);
      cur = { k: k, start: p.t, end: p.t };
    });
    if (cur && cur.k && cur.end - cur.start >= (cur.k === 'loud' ? 2 : 6)) res.push(cur);
    return res.slice(0, 12);
  }

  function drawLoud() {
    var c = $('lGraph'), L = S.loud;
    if (!c.clientWidth || !L || !L.series.length) return;
    var d = A.fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height, T = L.series[L.series.length - 1].t || 1;
    var Y = function (db) { return H - (Math.max(-40, Math.min(0, db)) + 40) / 40 * H; };
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(47,210,122,.12)'; g.fillRect(0, Y(-14), W, Y(-16) - Y(-14));
    g.strokeStyle = 'rgba(255,90,90,.6)'; g.setLineDash([4 * d, 4 * d]); g.beginPath(); g.moveTo(0, Y(-9)); g.lineTo(W, Y(-9)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#3d8bff'; g.lineWidth = 1.3 * d; g.beginPath();
    L.series.forEach(function (p, i) { var x = p.t / T * W, y = Y(p.s); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = '#8a8a93'; g.font = (9 * d) + 'px Segoe UI'; g.fillText('−14 LUFS', 4 * d, Y(-14) - 3 * d); g.fillText('−9', 4 * d, Y(-9) - 3 * d);
  }

  function pickLoudness() {
    var t = A.needTools(), f = A.pickFile('Choisir la vidéo exportée', ['mp4', 'mov', 'mxf', 'wav', 'MP4', 'MOV', 'WAV']);
    if (!f) return Promise.resolve();
    $('lResult').textContent = 'Mesure EBU R128 de ' + A.path.basename(f) + '…';
    return R360.ffmpeg.loudness(t, f).then(function (log) {
      var L = S.loud = core.parseEbur128(log);
      $('lResult').innerHTML = '<b>' + A.esc(A.path.basename(f)) + '</b> · ' + L.integrated.toFixed(1) + ' LUFS · crête ' + L.truePeak.toFixed(1) + ' dBTP · plage ' + (isFinite(L.lra) ? L.lra.toFixed(1) : '—') + ' LU';
      var ul = $('lIssues'); ul.innerHTML = '';
      loudnessVerdict(L).forEach(function (v) { ul.insertAdjacentHTML('beforeend', '<li class="' + v.cls + '">' + A.esc(v.text) + '</li>'); });
      zones(L).forEach(function (z) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="tc">' + core.fmtTime(z.start) + '–' + core.fmtTime(z.end) + '</span>' + (z.k === 'loud' ? 'Passage très fort : vérifie la musique / les SFX' : 'Passage presque muet : voulu ?');
        li.addEventListener('click', function () { A.go(z.start); });
        ul.appendChild(li);
      });
      drawLoud();
      return L;
    });
  }

  function init() {
    var tg = A.settings.targets;
    $('aVo').value = tg.vo; $('aMu').value = tg.mu; $('aFx').value = tg.fx;
    $('aAnalyze').addEventListener('click', function () { A.busy(this, analyze); });
    $('aApply').addEventListener('click', function () { A.busy(this, apply); });
    $('lPick').addEventListener('click', function () { A.busy(this, pickLoudness); });
    $('lGraph').addEventListener('click', function (e) {
      if (!S.loud || !S.loud.series.length) return;
      var r = this.getBoundingClientRect(); A.go((e.clientX - r.left) / r.width * S.loud.series[S.loud.series.length - 1].t);
    });
  }

  function show() { loadTracks().catch(function () {}); drawLoud(); }

  A.pages.audio = { init: init, show: show, analyze: analyze, apply: apply, loudnessVerdict: loudnessVerdict, state: S };
})(window);
