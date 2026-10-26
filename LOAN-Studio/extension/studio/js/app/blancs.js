/*
 * Blancs: automatic jump-cut. Detects silences in the selected timeline clip (face cam or voice-over)
 * and builds a new sequence with only the spoken parts — or just drops markers on the blanks.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var S = { clip: null, keep: null, silences: null, dur: 0 };

  function params() {
    var b = { thr: +$('bThr').value, min: +$('bMin').value, pad: +$('bPad').value };
    if (!(b.thr < 0)) b.thr = -38; if (!(b.min > 0)) b.min = 0.45; if (!(b.pad >= 0)) b.pad = 0.12;
    A.settings.blancs = b; A.saveSettings();
    return b;
  }

  function pick() {
    return A.run('ls_selectedClip').then(function (r) {
      if (!r.mediaPath) throw new Error('Ce clip n\'a pas de fichier média.');
      S.clip = r; S.keep = null;
      $('bClip').textContent = r.name + ' · ' + core.fmtTime(r.outPoint - r.inPoint) + ' (source ' + core.fmtTime(r.inPoint) + ' → ' + core.fmtTime(r.outPoint) + ')';
      $('bResult').textContent = ''; $('bApply').disabled = $('bMarkers').disabled = true;
      drawViz();
    });
  }

  function analyze() {
    var t = A.needTools();
    var go = S.clip ? Promise.resolve() : pick();
    return go.then(function () {
      var b = params(), c = S.clip;
      S.dur = c.outPoint - c.inPoint;
      $('bResult').textContent = 'Analyse de l\'audio…';
      return R360.ffmpeg.silences(t, c.mediaPath, c.inPoint, S.dur, b.thr, b.min).then(function (log) {
        S.silences = core.parseSilences(log);
        S.keep = core.speechSegments(S.silences, S.dur, b.pad, 0.25);
        var kept = S.keep.reduce(function (a, k) { return a + k.end - k.start; }, 0), removed = S.dur - kept;
        var blanks = Math.max(0, S.keep.length - 1) + (S.keep.length && S.keep[0].start > 0.01 ? 1 : 0) + (S.keep.length && S.keep[S.keep.length - 1].end < S.dur - 0.01 ? 1 : 0);
        $('bResult').innerHTML = S.keep.length
          ? '<b>' + blanks + ' blanc(s)</b> supprimé(s) · <b>−' + core.fmtTime(removed) + '</b> (−' + Math.round(removed / Math.max(0.001, S.dur) * 100) + ' %) · nouvelle durée <b>' + core.fmtTime(kept) + '</b> en ' + S.keep.length + ' morceau(x)'
          : '<span class="warn">Aucune parole détectée : baisse le seuil (ex. −45 dB).</span>';
        $('bApply').disabled = $('bMarkers').disabled = !S.keep.length || !removed;
        drawViz();
      });
    });
  }

  function drawViz() {
    var c = $('bViz'); if (!c.clientWidth) return;
    var d = A.fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!S.keep || !S.dur) return;
    g.fillStyle = 'rgba(255,90,90,.35)'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2fd27a';
    S.keep.forEach(function (k) { g.fillRect(k.start / S.dur * W, 0, Math.max(1, (k.end - k.start) / S.dur * W), H); });
  }

  function apply() {
    var c = S.clip, ranges = S.keep.map(function (k) { return [c.inPoint + k.start, c.inPoint + k.end]; });
    return A.run('ls_jumpcut', c.nodeId, ranges, c.name.replace(/\.[^.]+$/, '') + ' — sans blancs').then(function (r) {
      A.toast('✂️ Séquence « ' + r.name + ' » créée et ouverte : ' + r.cuts + ' morceaux, ' + core.fmtTime(r.duration) + '.', 'ok');
      return A.refreshContext();
    });
  }

  function markers() {
    var c = S.clip, list = [];
    // blanks = gaps between kept parts, mapped to sequence time
    var prev = 0;
    S.keep.concat([{ start: S.dur, end: S.dur }]).forEach(function (k) {
      if (k.start - prev > 0.05) list.push({ t: c.start + prev, end: c.start + k.start, name: '[BLANC] ' + (k.start - prev).toFixed(1) + ' s', comment: '', color: A.MARKER.red });
      prev = k.end;
    });
    return A.run('ls_syncSeqMarkers', [], list).then(function (r) { A.toast(r.created + ' marqueurs [BLANC] posés sur la séquence.', 'ok'); });
  }

  function init() {
    var b = A.settings.blancs;
    $('bThr').value = b.thr; $('bMin').value = b.min; $('bPad').value = b.pad;
    $('bPick').addEventListener('click', function () { A.busy(this, pick); });
    $('bAnalyze').addEventListener('click', function () { A.busy(this, analyze); });
    $('bApply').addEventListener('click', function () { A.busy(this, apply); });
    $('bMarkers').addEventListener('click', function () { A.busy(this, markers); });
  }

  A.pages.blancs = { init: init, show: drawViz, state: S };
})(window);
