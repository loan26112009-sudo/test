/*
 * Proxies: builds editing proxies (GoPro CineForm like Loan's usual workflow, or ProRes Proxy)
 * for the clips that have none, then attaches them in Premiere.
 */
(function (root) {
  'use strict';
  var A = root.LS.app, core = A.core, $ = A.$;
  var S = { list: [], job: null, cancelled: false };
  var NOT_VIDEO = /\.(wav|mp3|aac|m4a|aif|aiff|flac|ogg|png|jpe?g|tiff?|psd|gif|bmp|ai|svg|mogrt|prproj|srt)$/i;

  function settings() {
    var p = A.settings.proxy;
    p.codec = $('pCodec').value; p.width = +$('pWidth').value; A.saveSettings();
    return p;
  }
  function outDir(media) { return A.settings.proxy.dir || A.path.join(A.path.dirname(media), 'Proxies'); }
  function outFile(media) { return A.path.join(outDir(media), A.path.basename(media).replace(/\.[^.]+$/, '') + '_Proxy.mov'); }

  function scan() {
    var t = A.needTools();
    return A.run('ls_mediaItems', $('pScope').value).then(function (r) {
      var cands = r.items.filter(function (i) { return !i.hasProxy && i.mediaPath && !NOT_VIDEO.test(i.mediaPath) && A.fs.existsSync(i.mediaPath); });
      // one proxy per file, attached to every clip/subclip that uses it
      var byFile = {}, uniq = [];
      cands.forEach(function (c) {
        var k = c.mediaPath.toLowerCase();
        if (!byFile[k]) { byFile[k] = []; uniq.push(c); }
        byFile[k].push(c);
      });
      var i = 0, out = [];
      function next() {
        if (i >= uniq.length) return Promise.resolve(out);
        var c = uniq[i++];
        $('pResult').textContent = 'Analyse ' + i + ' / ' + uniq.length + '…';
        return R360.ffmpeg.probe(t, c.mediaPath).then(function (info) {
          if (info.width && info.height) out.push({ item: c, items: byFile[c.mediaPath.toLowerCase()], info: info });
        }, function () {}).then(next);
      }
      return next().then(function (list) {
        S.list = list;
        var dur = list.reduce(function (a, x) { return a + x.info.duration; }, 0);
        var clips = list.reduce(function (a, x) { return a + x.items.length; }, 0);
        $('pResult').innerHTML = list.length ? '<b>' + clips + ' clip(s)</b> sans proxy (' + list.length + ' fichier(s)) · ' + core.fmtDuration(dur) + ' de rushs' : 'Tous les clips ont déjà un proxy ✓';
        return list;
      });
    });
  }

  function start() {
    var t = A.needTools(), p = settings();
    S.cancelled = false;
    return scan().then(function (list) {
      if (!list.length) return;
      var i = 0, made = 0, attached = 0, failed = [];
      function next() {
        if (S.cancelled) throw new Error('CANCELLED');
        if (i >= list.length) return Promise.resolve();
        var x = list[i++], out = outFile(x.info.path);
        $('pResult').innerHTML = 'Proxy ' + i + ' / ' + list.length + ' : <b>' + A.esc(x.item.name) + '</b>';
        R360.ffmpeg.mkdirp(A.path.dirname(out));
        var make = A.fs.existsSync(out) ? Promise.resolve(out) : (S.job = R360.ffmpeg.makeProxy(t, x.info, {
          out: out, codec: p.codec, width: p.width, hw: A.settings.hw,
          onProgress: function (f) { $('pBar').style.width = ((i - 1 + f) / list.length * 100).toFixed(1) + '%'; }
        })).done.then(function (o) { made++; return o; });
        return make.then(function (o) {
          return x.items.reduce(function (pr, it) {
            return pr.then(function () { return A.run('ls_attachProxy', it.nodeId, o); })
              .then(function (r) { if (r.attached) attached++; else failed.push(it.name + ' (refusé par Premiere)'); });
          }, Promise.resolve());
        })
          .catch(function (e) { if (e.message === 'CANCELLED') throw e; failed.push(x.item.name + ' : ' + e.message.split('\n')[0]); })
          .then(next);
      }
      return next().then(function () {
        $('pBar').style.width = '100%';
        $('pResult').innerHTML = '✓ <b>' + attached + ' proxy(s) attaché(s)</b> (' + made + ' créé(s))' + (failed.length ? '<br><span class="bad">' + failed.map(A.esc).join('<br>') + '</span>' : '');
        A.toast('⚡ ' + attached + ' proxy(s) prêts. Active le bouton Proxys dans le moniteur Programme.', failed.length ? 'err' : 'ok');
      });
    }).catch(function (e) {
      if (e.message === 'CANCELLED') { $('pResult').textContent = 'Annulé.'; return; }
      throw e;
    });
  }

  function init() {
    var p = A.settings.proxy;
    $('pCodec').value = p.codec; $('pWidth').value = String(p.width);
    $('pDir').textContent = p.dir || '« Proxies » à côté des rushs';
    $('pScan').addEventListener('click', function () { A.busy(this, scan); });
    $('pStart').addEventListener('click', function () { A.busy(this, start); });
    $('pCancel').addEventListener('click', function () { S.cancelled = true; if (S.job) S.job.cancel(); });
    $('pDirBtn').addEventListener('click', function () {
      var d = A.host.chooseFolder('Dossier des proxies');
      A.settings.proxy.dir = d || ''; A.saveSettings();
      $('pDir').textContent = d || '« Proxies » à côté des rushs';
    });
  }

  A.pages.proxies = { init: init, scan: scan, start: start, state: S };
})(window);
