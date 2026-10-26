/*
 * Reframe 360 Pro — Premiere Pro ExtendScript host.
 * Every function returns a JSON string: { ok: true, ... } or { ok: false, error }.
 */

var R360_TICKS = 254016000000;
var R360_BIN = 'Reframe 360';

function r360_json(v) {
  var t = typeof v;
  if (v === null || t === 'undefined') return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    var s = '"';
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i), code = v.charCodeAt(i);
      if (c === '"' || c === '\\') s += '\\' + c;
      else if (code < 32) s += '\\u' + ('000' + code.toString(16)).slice(-4);
      else s += c;
    }
    return s + '"';
  }
  if (v instanceof Array) {
    var a = [];
    for (var j = 0; j < v.length; j++) a.push(r360_json(v[j]));
    return '[' + a.join(',') + ']';
  }
  var parts = [];
  for (var k in v) if (v.hasOwnProperty(k)) parts.push(r360_json(k) + ':' + r360_json(v[k]));
  return '{' + parts.join(',') + '}';
}

function r360_err(e) { return r360_json({ ok: false, error: String(e && e.message ? e.message : e) }); }

function r360_seqInfo(seq) {
  var fps = 0;
  try { fps = R360_TICKS / Number(seq.timebase); } catch (e) {}
  var pos = 0;
  try { pos = seq.getPlayerPosition().seconds; } catch (e2) {}
  return { name: seq.name, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: fps, player: pos };
}

function r360_findTrackIndex(seq, nodeId) {
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var tr = seq.videoTracks[t];
    for (var c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].nodeId === nodeId) return t;
  }
  return -1;
}

function r360_findClip(seq, nodeId) {
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var tr = seq.videoTracks[t];
    for (var c = 0; c < tr.clips.numItems; c++) if (tr.clips[c].nodeId === nodeId) return tr.clips[c];
  }
  return null;
}

function r360_ping() {
  return r360_json({ ok: true, version: app.version, project: app.project ? app.project.path : '' });
}

// First selected video clip of the active sequence.
function r360_getSelection() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return r360_json({ ok: false, error: 'Aucune séquence active. Ouvre une séquence dans la timeline.' });
    var sel = seq.getSelection();
    var item = null;
    for (var i = 0; i < sel.length; i++) {
      var it = sel[i];
      if (it.mediaType === 'Video' || (it.projectItem && r360_findTrackIndex(seq, it.nodeId) >= 0)) { item = it; break; }
    }
    if (!item) return r360_json({ ok: false, error: 'Sélectionne un clip 360 dans la timeline, puis clique à nouveau.' });
    var pi = item.projectItem;
    var mediaPath = pi ? pi.getMediaPath() : '';
    if (!mediaPath) return r360_json({ ok: false, error: 'Ce clip n\'a pas de fichier média (séquence imbriquée ou titre ?).' });
    var speed = 1;
    try { speed = item.getSpeed(); } catch (e) {}
    var reversed = false;
    try { reversed = item.isSpeedReversed(); } catch (e3) {}
    return r360_json({
      ok: true, name: item.name, mediaPath: mediaPath, nodeId: item.nodeId,
      inPoint: item.inPoint.seconds, outPoint: item.outPoint.seconds,
      start: item.start.seconds, end: item.end.seconds,
      trackIndex: r360_findTrackIndex(seq, item.nodeId), speed: speed, reversed: reversed,
      seq: r360_seqInfo(seq), projectPath: app.project.path
    });
  } catch (e) { return r360_err(e); }
}

function r360_getSequence() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return r360_json({ ok: false, error: 'Aucune séquence active.' });
    return r360_json({ ok: true, seq: r360_seqInfo(seq) });
  } catch (e) { return r360_err(e); }
}

function r360_getPlayer() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return r360_json({ ok: false });
    return r360_json({ ok: true, seconds: seq.getPlayerPosition().seconds });
  } catch (e) { return r360_err(e); }
}

function r360_setPlayer(seconds) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return r360_json({ ok: false });
    var ticks = Math.round(seconds * R360_TICKS);
    seq.setPlayerPosition(String(ticks));
    return r360_json({ ok: true });
  } catch (e) { return r360_err(e); }
}

function r360_getBin() {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var c = root.children[i];
    if (c.type === ProjectItemType.BIN && c.name === R360_BIN) return c;
  }
  var b = root.createBin(R360_BIN);
  if (b) return b;
  for (var j = 0; j < root.children.numItems; j++) {
    var d = root.children[j];
    if (d.type === ProjectItemType.BIN && d.name === R360_BIN) return d;
  }
  return root;
}

function r360_norm(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }

function r360_findItem(bin, path) {
  var want = r360_norm(path);
  for (var i = bin.children.numItems - 1; i >= 0; i--) {
    var c = bin.children[i];
    try { if (c.type !== ProjectItemType.BIN && r360_norm(c.getMediaPath()) === want) return c; } catch (e) {}
  }
  return null;
}

/*
 * opts: { path, place, trackIndex, start, nodeId, disableOriginal }
 * Imports the rendered file into the "Reframe 360" bin and, if asked, drops it on the
 * track above the original clip at the same time, then disables the original.
 */
function r360_importAndPlace(opts) {
  try {
    var bin = r360_getBin();
    var ok = app.project.importFiles([opts.path], true, bin, false);
    var item = r360_findItem(bin, opts.path);
    if (!item) return r360_json({ ok: false, error: 'Import impossible (' + ok + ') : ' + opts.path });
    var placed = false, note = '';
    if (opts.place) {
      var seq = app.project.activeSequence;
      if (!seq) return r360_json({ ok: true, placed: false, note: 'Importé dans le chutier (pas de séquence active).' });
      var target = (opts.trackIndex >= 0 ? opts.trackIndex : 0) + 1;
      if (target >= seq.videoTracks.numTracks) {
        try {
          app.enableQE();
          qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0);
        } catch (eq) { note = 'Ajout de piste impossible : '; }
      }
      if (target < seq.videoTracks.numTracks) {
        var t = new Time();
        t.seconds = opts.start;
        try { seq.videoTracks[target].overwriteClip(item, t); }
        catch (e1) { seq.videoTracks[target].overwriteClip(item, opts.start); }
        placed = true;
        if (opts.disableOriginal && opts.nodeId) {
          var orig = r360_findClip(seq, opts.nodeId);
          try { if (orig) orig.disabled = true; } catch (e2) { note += 'Clip d\'origine non désactivé (version de Premiere). '; }
        }
      } else {
        note += 'importé dans le chutier "' + R360_BIN + '".';
      }
    }
    return r360_json({ ok: true, placed: placed, note: note, name: item.name });
  } catch (e) { return r360_err(e); }
}

function r360_projectDir() {
  try {
    var p = app.project.path || '';
    var i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return r360_json({ ok: true, dir: i > 0 ? p.substring(0, i) : '' });
  } catch (e) { return r360_err(e); }
}
