/*
 * Accueil: release planning (Loan's long-video protocol), "Ordre d'or" checklist,
 * focused editing session timer + resume note, one-click backup.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;

  // ------------------------------------------------------------------ planning

  function renderDeadlines() {
    var p = A.project, list = $('deadlines');
    $('releaseDate').value = p.release || '';
    list.innerHTML = '';
    if (!p.release) { list.innerHTML = '<li class="hint">Choisis la date de sortie : toutes les échéances se calculent toutes seules.</li>'; updateCountdown(); return; }
    core.deadlines(p.release).forEach(function (d) {
      var li = document.createElement('li'), cls = d.daysLeft < 0 ? 'past' : '';
      if (d.id === 'montage' || d.id === 'sortie') cls += ' key';
      li.className = cls;
      var chip = d.daysLeft < 0 ? '' : d.daysLeft === 0 ? 'aujourd\'hui' : 'J−' + d.daysLeft;
      var chipCls = d.daysLeft <= 1 ? 'bad' : d.daysLeft <= 3 ? 'warn' : '';
      li.innerHTML = '<span class="d">' + d.date.slice(8, 10) + '/' + d.date.slice(5, 7) + '</span><span class="t">' + A.esc(d.label) + '</span>' +
        (chip ? '<span class="chip ' + chipCls + '">' + chip + '</span>' : '<span class="chip">✓</span>');
      list.appendChild(li);
    });
    updateCountdown();
  }

  // Header chip: next deadline that matters while editing.
  function updateCountdown() {
    var el = $('countdown'), p = A.project;
    el.className = 'chip'; el.textContent = '';
    if (!p.release) return;
    var next = core.deadlines(p.release).filter(function (d) { return d.daysLeft >= 0; })[0];
    if (!next) return;
    var short = { sujet: 'Sujet', ecriture: 'Écriture', tournage: 'Tournage', montage: 'Montage fini', prep: 'Upload', sortie: 'Sortie', short: 'Short bonus', stats: 'Stats' }[next.id];
    el.textContent = short + ' ' + (next.daysLeft === 0 ? 'aujourd\'hui' : 'J−' + next.daysLeft);
    el.className = 'chip ' + (next.daysLeft <= 1 ? 'bad' : next.daysLeft <= 3 ? 'warn' : 'ok');
    el.title = next.label + ' — ' + next.date;
  }

  // ------------------------------------------------------------------ golden order

  function renderGolden() {
    var p = A.project, done = p.golden || {}, ul = $('golden'), n = 0, current = null;
    ul.innerHTML = '';
    core.GOLDEN_ORDER.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.label;
      if (done[s.id]) { li.className = 'done'; n++; }
      else if (!current) { current = s; li.className = 'current'; }
      li.addEventListener('click', function () {
        p.golden = p.golden || {};
        p.golden[s.id] = !p.golden[s.id];
        A.saveProject(); renderGolden();
      });
      ul.appendChild(li);
    });
    var pct = Math.round(n / core.GOLDEN_ORDER.length * 100);
    $('goldenBar').style.width = pct + '%';
    $('goldenProgress').textContent = n + '/' + core.GOLDEN_ORDER.length + (current ? ' · en cours : ' + current.label.split(' (')[0].split(' —')[0] : ' · terminé 🎉');
  }

  // ------------------------------------------------------------------ session timer

  var timer = { end: 0, id: null, minutes: A.settings.timerMin || 25 };
  function fmtClock(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function tick() {
    var left = timer.end - Date.now();
    $('timerClock').textContent = fmtClock(left);
    if (left <= 0) {
      stopTimer();
      A.toast('⏱️ Session terminée. Arrête-toi au milieu d\'une coupe et note où tu en es.', 'ok');
      $('resumeNote').focus();
      var p = A.project;
      p.sessions = (p.sessions || 0) + 1; A.saveProject();
    }
  }
  function startTimer() {
    timer.end = Date.now() + timer.minutes * 60000;
    $('timerStart').textContent = 'Arrêter';
    clearInterval(timer.id); timer.id = setInterval(tick, 500); tick();
  }
  function stopTimer() {
    clearInterval(timer.id); timer.id = null;
    $('timerStart').textContent = 'Démarrer';
    $('timerClock').textContent = fmtClock(timer.minutes * 60000);
  }

  // ------------------------------------------------------------------ backup

  function backupDir() {
    if (A.settings.backupDir) return A.settings.backupDir;
    if (!A.ctx.project || !A.ctx.project.path) return null;
    return A.path.join(A.path.dirname(A.ctx.project.path), 'Backups LOAN');
  }

  function backup() {
    return A.run('ls_save').then(function (r) {
      if (!A.fs || !r.path) throw new Error('Projet enregistré, mais pas encore de fichier .prproj (enregistre-le une première fois).');
      var dir = backupDir();
      R360.ffmpeg.mkdirp(dir);
      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      var base = A.path.basename(r.path).replace(/\.prproj$/i, '');
      var dest = A.path.join(dir, base + '_' + stamp + '.prproj');
      A.fs.copyFileSync(r.path, dest);
      // keep the 20 most recent copies of this project
      var mine = A.fs.readdirSync(dir).filter(function (f) { return f.indexOf(base + '_') === 0 && /\.prproj$/i.test(f); }).sort();
      mine.slice(0, Math.max(0, mine.length - 20)).forEach(function (f) { try { A.fs.unlinkSync(A.path.join(dir, f)); } catch (e) {} });
      A.project.lastBackup = Date.now(); A.saveProject();
      renderBackup();
      A.toast('💾 Projet sauvegardé + copie dans « ' + dir + ' »', 'ok');
      return dest;
    });
  }
  function renderBackup() {
    var t = A.project.lastBackup;
    $('backupInfo').textContent = t ? 'Dernière copie : ' + new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Aucune copie pour ce projet';
  }

  // ------------------------------------------------------------------ resume note

  function renderResume() {
    var note = (A.project.resume || '').trim();
    $('resumeNote').value = A.project.resume || '';
    $('resumeText').textContent = note;
    $('resume').classList.toggle('on', !!note && !A.project.resumeSeen);
  }

  function init() {
    $('releaseDate').addEventListener('change', function () { A.project.release = this.value; A.saveProject(); renderDeadlines(); });
    Array.prototype.forEach.call(document.querySelectorAll('.timer [data-min]'), function (b) {
      b.addEventListener('click', function () {
        timer.minutes = +b.getAttribute('data-min'); A.settings.timerMin = timer.minutes; A.saveSettings();
        if (timer.id) startTimer(); else stopTimer();
      });
    });
    $('timerStart').addEventListener('click', function () { if (timer.id) stopTimer(); else startTimer(); });
    $('resumeNote').addEventListener('input', function () { A.project.resume = this.value; A.project.resumeSeen = false; A.saveProject(); });
    $('resumeClose').addEventListener('click', function () { A.project.resumeSeen = true; A.saveProject(); $('resume').classList.remove('on'); });
    $('btnBackup').addEventListener('click', function () { A.busy(this, backup); });
    stopTimer();
    A.on('project', function () { renderDeadlines(); renderGolden(); renderBackup(); renderResume(); });
  }

  A.pages.home = { init: init, backup: backup, backupDir: backupDir };
})(window);
