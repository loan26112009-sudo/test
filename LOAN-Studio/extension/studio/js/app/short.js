/*
 * Short: turns the in/out range of the sequence into a new 9:16 sequence (Premiere Auto Reframe)
 * and keeps Loan's retention structure for Shorts at hand.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var CHECKS = [
    { id: 'hook', label: 'Hook 0–3 s : le plan final le plus intense + la phrase choc' },
    { id: 'lieu', label: 'Lieu + objectif en une phrase (3–7 s)' },
    { id: 'comment', label: 'Comment je filme / ce que je fais, geste à l\'appui' },
    { id: 'tease', label: 'Tease : « je vous montre ça juste après » (boucle ouverte)' },
    { id: 'coeur', label: 'Le cœur : la scène qui paie la promesse, rushs réels + jump cuts' },
    { id: 'cta', label: 'Révélation + CTA discret vers la vidéo longue' },
    { id: 'loop', label: 'La dernière image renvoie à la première (boucle → rewatch)' },
    { id: 'texte', label: 'Sous-titres lisibles dans la zone sûre 9:16 (pas en bas)' }
  ];

  function renderRange() {
    var s = A.ctx.seq;
    if (!s) { $('shRange').textContent = 'Aucune séquence active'; return; }
    var has = s.outPoint > s.inPoint && !(s.inPoint <= 0 && s.outPoint >= s.duration - 0.01);
    var d = s.outPoint - s.inPoint;
    $('shRange').innerHTML = has
      ? core.fmtTime(s.inPoint) + ' → ' + core.fmtTime(s.outPoint) + ' · <b>' + core.fmtDuration(d) + '</b>' + (d > 60 ? ' <span class="warn">(> 60 s : OK jusqu\'à 3 min sur YouTube Shorts)</span>' : '')
      : '<span class="warn">Pose I et O dans la séquence (touches I et O de Premiere)</span>';
    if (!/^SHORT/.test(s.name)) $('shName').placeholder = 'SHORT — ' + s.name;
  }

  function renderChecks() {
    var p = A.project, done = p.shortChecks || {}, ul = $('shChecklist'), n = 0;
    ul.innerHTML = '';
    CHECKS.forEach(function (c) {
      var li = document.createElement('li');
      li.textContent = c.label;
      if (done[c.id]) { li.className = 'done'; n++; }
      li.addEventListener('click', function () { p.shortChecks = p.shortChecks || {}; p.shortChecks[c.id] = !p.shortChecks[c.id]; A.saveProject(); renderChecks(); });
      ul.appendChild(li);
    });
    $('shProgress').textContent = n + '/' + CHECKS.length;
  }

  function make() {
    return A.refreshContext().then(function () {
      var s = A.ctx.seq;
      if (!s) throw new Error('Ouvre la séquence de la vidéo longue.');
      var name = $('shName').value.trim() || ('SHORT — ' + s.name.replace(/^SHORT — /, '') + ' — ' + core.fmtTime(s.inPoint));
      return A.run('ls_createShort', name, $('shReframe').checked);
    }).then(function (r) {
      $('shResult').innerHTML = '✓ <b>' + A.esc(r.name) + '</b> créée et ouverte (' + core.fmtDuration(r.duration) + ')' + (r.reframed ? ', recadrée en 9:16.' : '. <span class="warn">Auto Reframe indisponible : passe la séquence en 1080×1920 (Séquence › Paramètres).</span>');
      var p = A.project; p.shortChecks = {}; A.saveProject(); renderChecks();
      return A.refreshContext();
    });
  }

  function init() {
    $('shMake').addEventListener('click', function () { A.busy(this, make); });
    A.on('ctx', function () { if (A.pages.current === 'short') renderRange(); });
    A.on('project', renderChecks);
  }

  A.pages.short = { init: init, show: renderRange };
})(window);
