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
  return { id: seq.sequenceID, name: seq.name, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: fps, player: pos };
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

// Active sequence, but only if it is the one the panel is working on.
function r360_seq(seqId) {
  var seq = app.project.activeSequence;
  if (!seq) return null;
  if (seqId && seq.sequenceID !== seqId) return null;
  return seq;
}

function r360_ping() {
  return r360_json({ ok: true, version: app.version, project: app.project ? app.project.path : '' });
}

function r360_clipInfo(seq, item) {
  var pi = item.projectItem;
  var mediaPath = pi ? pi.getMediaPath() : '';
  var speed = 1;
  try { speed = item.getSpeed(); } catch (e) {}
  var reversed = false;
  try { reversed = item.isSpeedReversed(); } catch (e3) {}
  return {
    ok: true, name: item.name, mediaPath: mediaPath, nodeId: item.nodeId,
    inPoint: item.inPoint.seconds, outPoint: item.outPoint.seconds,
    start: item.start.seconds, end: item.end.seconds,
    trackIndex: r360_findTrackIndex(seq, item.nodeId), speed: speed, reversed: reversed,
    seq: r360_seqInfo(seq), projectPath: app.project.path
  };
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
      if (r360_findTrackIndex(seq, it.nodeId) >= 0) { item = it; break; }
    }
    if (!item) return r360_json({ ok: false, error: 'Sélectionne un clip 360 dans la timeline (clic sur le clip vidéo), puis clique à nouveau.' });
    var info = r360_clipInfo(seq, item);
    if (!info.mediaPath) return r360_json({ ok: false, error: 'Ce clip n\'a pas de fichier média (séquence imbriquée, titre ou calque d\'effets ?).' });
    return r360_json(info);
  } catch (e) { return r360_err(e); }
}

// Current state of a clip already loaded in the panel (it may have been moved or trimmed since).
function r360_getClip(nodeId, seqId) {
  try {
    var seq = r360_seq(seqId);
    if (!seq) return r360_json({ ok: false, error: 'La séquence du clip n\'est plus active.' });
    var item = r360_findClip(seq, nodeId);
    if (!item) return r360_json({ ok: false, error: 'Le clip d\'origine n\'est plus dans la séquence.' });
    return r360_json(r360_clipInfo(seq, item));
  } catch (e) { return r360_err(e); }
}

function r360_getSequence() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return r360_json({ ok: false, error: 'Aucune séquence active.' });
    return r360_json({ ok: true, seq: r360_seqInfo(seq) });
  } catch (e) { return r360_err(e); }
}

function r360_getPlayer(seqId) {
  try {
    var seq = r360_seq(seqId);
    if (!seq) return r360_json({ ok: false });
    return r360_json({ ok: true, seconds: seq.getPlayerPosition().seconds });
  } catch (e) { return r360_err(e); }
}

function r360_setPlayer(seconds, seqId) {
  try {
    var seq = r360_seq(seqId);
    if (!seq) return r360_json({ ok: false });
    seq.setPlayerPosition(String(Math.round(seconds * R360_TICKS)));
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

// First unlocked video track from `first` upward that is empty between start and end.
function r360_freeTrack(seq, first, start, end) {
  for (var t = first; t < seq.videoTracks.numTracks; t++) {
    var tr = seq.videoTracks[t], free = true;
    try { if (tr.isLocked()) continue; } catch (e) {}
    for (var c = 0; c < tr.clips.numItems; c++) {
      var cl = tr.clips[c];
      if (cl.start.seconds < end - 0.0001 && cl.end.seconds > start + 0.0001) { free = false; break; }
    }
    if (free) return t;
  }
  return -1;
}

function r360_addVideoTrack(seq) {
  var before = seq.videoTracks.numTracks;
  app.enableQE();
  var qs = qe.project.getActiveSequence();
  try { qs.addTracks(1, before, 0, 1, 0, 0, 0); } catch (e) {}
  seq = app.project.activeSequence;
  if (seq.videoTracks.numTracks === before) {
    try { qs.addTracks(1, before, 0); } catch (e2) {}
    seq = app.project.activeSequence;
  }
  return seq.videoTracks.numTracks > before;
}

/*
 * opts: { path, place, nodeId, seqId, trackIndex, start, duration, disableOriginal }
 * Imports the rendered file into the "Reframe 360" bin and, if asked, drops it on the first
 * free video track above the original clip (never overwriting anything), at the clip's
 * current position, then disables the original.
 */
function r360_importAndPlace(opts) {
  try {
    var bin = r360_getBin();
    var ok = app.project.importFiles([opts.path], true, bin, false);
    var item = r360_findItem(bin, opts.path);
    if (!item) return r360_json({ ok: false, error: 'Import impossible (' + ok + ') : ' + opts.path });
    if (!opts.place) return r360_json({ ok: true, placed: false, note: '', name: item.name });

    var seq = r360_seq(opts.seqId);
    if (!seq) return r360_json({ ok: true, placed: false, note: 'La séquence d\'origine n\'est plus active : le plan est dans le chutier « ' + R360_BIN + ' ».' });
    var orig = opts.nodeId ? r360_findClip(seq, opts.nodeId) : null;
    var start = orig ? orig.start.seconds : opts.start;
    var end = start + opts.duration;
    var base = orig ? r360_findTrackIndex(seq, opts.nodeId) : opts.trackIndex;
    var target = r360_freeTrack(seq, Math.max(0, base) + 1, start, end);
    if (target < 0) {
      if (!r360_addVideoTrack(seq)) return r360_json({ ok: true, placed: false, note: 'Aucune piste vidéo libre au-dessus du clip : le plan est dans le chutier « ' + R360_BIN + ' ».' });
      seq = app.project.activeSequence;
      target = seq.videoTracks.numTracks - 1;
    }
    var t = new Time();
    t.seconds = start;
    try { seq.videoTracks[target].overwriteClip(item, t); }
    catch (e1) { seq.videoTracks[target].overwriteClip(item, start); }
    var note = 'Piste V' + (target + 1) + '. ';
    if (opts.disableOriginal && orig) {
      try { orig.disabled = true; } catch (e2) { note += 'Désactive le clip 360 d\'origine à la main (Maj+E). '; }
    }
    return r360_json({ ok: true, placed: true, note: note, name: item.name });
  } catch (e) { return r360_err(e); }
}

function r360_projectDir() {
  try {
    var p = app.project.path || '';
    var i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return r360_json({ ok: true, dir: i > 0 ? p.substring(0, i) : '' });
  } catch (e) { return r360_err(e); }
}
