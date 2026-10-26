/*
 * Vérif: pre-export audit of the active sequence, feedback timestamps -> markers,
 * and a technical check of the exported file (format, colour tags, loudness).
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var ICON = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };

  function isPlaceholder(v) {
    var p = (v.mediaPath || '').replace(/\\/g, '/');
    return /\/PLACEHOLDER_[^/]*$/i.test(p) || /\/LOAN Studio\/Placeholders\//i.test(p) || /^PLACEHOLDER/i.test(v.name || '');
  }

  // Time ranges with no visible clip (black frames) between 0 and the end of the sequence.
  function blackGaps(video, duration, fps) {
    var iv = video.filter(function (v) { return !v.disabled && !v.trackMuted; }).map(function (v) { return [v.start, v.end]; }).sort(function (a, b) { return a[0] - b[0]; });
    var gaps = [], t = 0, eps = 0.5 / (fps || 30);
    iv.forEach(function (r) { if (r[0] > t + eps) gaps.push({ start: t, end: r[0] }); t = Math.max(t, r[1]); });
    if (duration > t + eps) gaps.push({ start: t, end: duration });
    return gaps;
  }

  function item(list, status, text, detail, times) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="s">' + ICON[status] + '</span><span class="x">' + A.esc(text) + (detail ? '<small>' + detail + '</small>' : '') + '</span>';
    if (times && times.length) {
      var sm = document.createElement('small');
      times.slice(0, 12).forEach(function (t) {
        var a = document.createElement('span');
        a.className = 'go'; a.textContent = core.fmtTime(t.start) + (t.label ? ' ' + t.label : '');
        a.title = 'Aller à ' + core.fmtTC(t.start, A.ctx.seq && A.ctx.seq.fps);
        a.addEventListener('click', function () { A.go(t.start); });
        sm.appendChild(a);
      });
      if (times.length > 12) sm.appendChild(document.createTextNode('+' + (times.length - 12)));
      li.querySelector('.x').appendChild(sm);
    }
    list.appendChild(li);
    return status;
  }

  function audit() {
    return A.run('ls_audit').then(function (r) {
      var ul = $('vList'), seq = r.seq, res = [], p = A.project;
      ul.innerHTML = '';
      var add = function () { res.push(item.apply(null, [ul].concat([].slice.call(arguments)))); };

      var ph = r.video.filter(isPlaceholder);
      if (ph.length) add('bad', ph.length + ' placeholder(s) encore dans la timeline', 'Remplace-les par les vrais plans avant l\'export.', ph.map(function (v) { return { start: v.start, label: v.name.replace(/^PLACEHOLDER_/, '').replace(/_[a-z0-9]+\.mp4$/i, '') }; }));
      else add('ok', 'Aucun placeholder oublié');

      var paths = {}, missing = [];
      r.video.concat(r.audio).forEach(function (c) { if (c.mediaPath && !paths[c.mediaPath]) { paths[c.mediaPath] = 1; if (A.fs && !A.fs.existsSync(c.mediaPath)) missing.push(c); } });
      if (missing.length) add('bad', missing.length + ' média(s) hors ligne', missing.slice(0, 5).map(function (c) { return A.esc(c.mediaPath); }).join('<br>'), missing.map(function (c) { return { start: c.start, label: c.name }; }));
      else add('ok', 'Tous les médias sont en ligne (' + Object.keys(paths).length + ' fichiers)');

      var gaps = blackGaps(r.video, seq.duration, seq.fps).filter(function (g) { return g.end - g.start >= 1 / (seq.fps || 30); });
      if (gaps.length) add('warn', gaps.length + ' trou(s) noir(s) dans l\'image', 'Aucune image visible à ces moments (voulu ?).', gaps.map(function (g) { return { start: g.start, label: '(' + (g.end - g.start).toFixed(1) + ' s)' }; }));
      else add('ok', 'Pas de trou noir dans l\'image');

      var fb = r.markers.filter(function (m) { return /^\[FB\]/.test(m.name); });
      var todo = r.markers.filter(function (m) { return /TODO|À FAIRE|A FAIRE|FIXME/i.test(m.name + ' ' + m.comment); });
      var blanks = r.markers.filter(function (m) { return /^\[BLANC\]/.test(m.name); });
      if (fb.length) add('warn', fb.length + ' feedback(s) pas encore traité(s)', 'Coche-les dans la carte Feedbacks une fois corrigés.', fb.map(function (m) { return { start: m.start, label: m.name.slice(5, 30) }; }));
      if (todo.length) add('warn', todo.length + ' marqueur(s) TODO', '', todo.map(function (m) { return { start: m.start, label: m.name.slice(0, 25) }; }));
      if (blanks.length) add('info', blanks.length + ' marqueur(s) [BLANC] restants', 'Tu peux les supprimer une fois les coupes faites.');
      if (!fb.length && !todo.length) add('ok', 'Aucun feedback ou TODO en attente');

      var dis = r.video.filter(function (v) { return v.disabled; });
      if (dis.length) add('info', dis.length + ' clip(s) désactivé(s)', 'Normal pour les clips 360 recadrés ; sinon, vérifie qu\'ils ne manquent pas.');

      var sizeOk = seq.width * seq.height >= 1920 * 1080;
      add(sizeOk ? 'ok' : 'warn', 'Séquence ' + seq.width + '×' + seq.height + ' · ' + (Math.round(seq.fps * 100) / 100) + ' im/s · ' + core.fmtTime(seq.duration), sizeOk ? '' : 'En dessous du 1080p : YouTube réduira la qualité.');
      if (p.target) {
        var d = seq.duration - p.target;
        add(Math.abs(d) <= p.target * 0.1 ? 'ok' : 'warn', 'Durée ' + core.fmtTime(seq.duration) + ' pour une cible de ' + core.fmtTime(p.target), Math.abs(d) > p.target * 0.1 ? (d > 0 ? 'Plus long que prévu : chaque minute en trop coûte de la rétention.' : 'Plus court que prévu.') : '');
      }
      if ((p.loops || []).length) {
        var ret = core.retention(p.loops, seq.duration, { step: Math.max(0.5, seq.duration / 600), minGap: 8 });
        var none = ret.issues.filter(function (i) { return i.type === 'none'; });
        add(none.length ? 'warn' : 'ok', none.length ? none.length + ' moment(s) sans aucune boucle ouverte' : 'Rétention : toujours au moins une boucle ouverte', none.length ? 'Voir la carte de rétention (Structure).' : '', none.map(function (i) { return { start: i.start, label: '' }; }));
      }
      var age = p.lastBackup ? (Date.now() - p.lastBackup) / 3600000 : Infinity;
      add(age < 24 ? 'ok' : 'warn', age < 24 ? 'Copie de secours de moins de 24 h' : 'Pas de copie de secours récente', age < 24 ? '' : 'Accueil › Sauvegarder + copie de secours.');
      add('info', 'Proxys : l\'export utilise toujours les fichiers originaux, même si le bouton Proxys est activé.');

      var bad = res.filter(function (s) { return s === 'bad'; }).length, warn = res.filter(function (s) { return s === 'warn'; }).length;
      $('vSummary').innerHTML = bad ? '<span style="color:var(--bad)">' + bad + ' erreur(s)</span> · ' + warn + ' avertissement(s)' : warn ? warn + ' avertissement(s)' : 'Tout est bon : exporte 🚀';
      if (!bad && !warn) { p.golden = p.golden || {}; p.golden.verifs = true; A.saveProject(); A.emit('project', p); }
      return { bad: bad, warn: warn };
    });
  }

  // ------------------------------------------------------------------ feedback

  function renderFeedback() {
    if (!A.host.inPremiere) return Promise.resolve();
    return A.run('ls_seqMarkers').then(function (r) {
      var ul = $('fbList'), list = r.markers.filter(function (m) { return /^\[(FB|OK)\]/.test(m.name); });
      ul.innerHTML = '';
      var open = list.filter(function (m) { return /^\[FB\]/.test(m.name); }).length;
      $('fbInfo').textContent = list.length ? open + ' à traiter · ' + (list.length - open) + ' fait(s)' : '';
      list.forEach(function (m) {
        var li = document.createElement('li'), done = /^\[OK\]/.test(m.name);
        li.innerHTML = '<span class="dot" style="background:' + (done ? '#2fd27a' : '#f39c32') + '"></span><span class="meta">' + core.fmtTime(m.start) + '</span><span class="nm">' + A.esc(m.name.slice(5)) + '</span>' + (done ? '' : '<span class="act">✓ fait</span>');
        li.addEventListener('click', function (e) {
          if (!done && e.target.className === 'act') {
            A.run('ls_renameSeqMarker', m.start, m.name, '[OK] ' + m.name.slice(5), A.MARKER.green).then(renderFeedback);
          } else A.go(m.start);
        });
        ul.appendChild(li);
      });
    });
  }

  function pushFeedback() {
    var items = core.parseFeedback($('fbText').value);
    if (!items.length) throw new Error('Aucun timecode trouvé (format 2:31, 1:02:31 ou 4min10).');
    var list = items.map(function (f) { return { t: f.t, end: f.end || 0, name: '[FB] ' + f.text, comment: '', color: A.MARKER.orange }; });
    return A.run('ls_syncSeqMarkers', [], list).then(function (r) {
      A.toast('💬 ' + r.created + ' feedback(s) posés en marqueurs orange.', 'ok');
      $('fbText').value = '';
      return renderFeedback();
    });
  }

  // ------------------------------------------------------------------ exported file

  function checkExport() {
    var t = A.needTools(), f = A.pickFile('Choisir la vidéo exportée', ['mp4', 'mov', 'mxf', 'MP4', 'MOV']);
    if (!f) return Promise.resolve();
    var ul = $('eList');
    ul.innerHTML = '<li><span class="s">⏳</span><span class="x">Analyse de ' + A.esc(A.path.basename(f)) + '…</span></li>';
    return Promise.all([R360.ffmpeg.probe(t, f), R360.ffmpeg.loudness(t, f).then(core.parseEbur128, function () { return null; })]).then(function (res) {
      var i = res[0], L = res[1], seq = A.ctx.seq;
      ul.innerHTML = '';
      var mbps = i.sizeBytes * 8 / Math.max(1, i.duration) / 1e6;
      item(ul, 'info', A.path.basename(f), i.width + '×' + i.height + ' · ' + (Math.round(i.fps * 100) / 100) + ' im/s · ' + i.codec.toUpperCase() + ' ' + i.bits + ' bits · ' + mbps.toFixed(0) + ' Mb/s · ' + core.fmtTime(i.duration));
      if (seq) {
        item(ul, i.width === seq.width && i.height === seq.height ? 'ok' : 'warn', 'Résolution ' + (i.width === seq.width && i.height === seq.height ? 'identique à la séquence' : i.width + '×' + i.height + ' au lieu de ' + seq.width + '×' + seq.height));
        item(ul, Math.abs(i.fps - seq.fps) < 0.01 ? 'ok' : 'warn', 'Cadence ' + (Math.abs(i.fps - seq.fps) < 0.01 ? 'identique à la séquence' : (Math.round(i.fps * 100) / 100) + ' au lieu de ' + (Math.round(seq.fps * 100) / 100) + ' im/s'));
        var dd = Math.abs(i.duration - seq.duration);
        item(ul, dd < 1 ? 'ok' : 'info', dd < 1 ? 'Durée = séquence complète' : 'Durée ' + core.fmtTime(i.duration) + ' (séquence ' + core.fmtTime(seq.duration) + ') : export d\'une plage ?');
      }
      item(ul, i.width * i.height >= 3840 * 2160 * 0.9 ? 'ok' : i.width * i.height >= 1920 * 1080 ? 'info' : 'warn',
        i.width * i.height >= 3840 * 2160 * 0.9 ? 'Export 4K : YouTube encodera en VP9/AV1, meilleure qualité même en 1080p' : i.width * i.height >= 1920 * 1080 ? 'Export 1080p (astuce : un export 4K donne une meilleure qualité sur YouTube, même vu en 1080p)' : 'Résolution faible pour YouTube');
      var tagOk = /709/.test(i.color.colorspace) && /709/.test(i.color.transfer);
      item(ul, tagOk ? 'ok' : 'warn', tagOk ? 'Couleurs Rec.709 correctement étiquetées' : 'Étiquettes couleur : ' + i.color.colorspace + ' / ' + i.color.transfer, tagOk ? '' : 'Pour du SDR YouTube, exporte en Rec.709 (sinon couleurs délavées ou trop saturées).');
      item(ul, i.hasAudio ? 'ok' : 'bad', i.hasAudio ? 'Audio présent (' + (i.sampleRate || '?') + ' Hz)' : 'Pas d\'audio dans le fichier !');
      if (L) A.pages.audio.loudnessVerdict(L).forEach(function (v) { item(ul, v.cls === 'ok' ? 'ok' : v.cls === 'bad' ? 'bad' : 'warn', v.text); });
    });
  }

  function init() {
    $('vRun').addEventListener('click', function () { A.busy(this, audit); });
    $('fbPush').addEventListener('click', function () { A.busy(this, pushFeedback); });
    $('fbText').addEventListener('input', function () {
      var n = core.parseFeedback(this.value).length;
      $('fbInfo').textContent = n ? n + ' timecode(s) reconnu(s)' : '';
    });
    $('eBtn').addEventListener('click', function () { A.busy(this, checkExport); });
  }

  A.pages.verif = { init: init, show: function () { renderFeedback().catch(function () {}); }, audit: audit, blackGaps: blackGaps, isPlaceholder: isPlaceholder };
})(window);
