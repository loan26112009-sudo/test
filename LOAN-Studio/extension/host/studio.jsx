/*
 * LOAN Studio — Premiere Pro ExtendScript host.
 * Every ls_* function returns a JSON string: { ok: true, ... } or { ok: false, error }.
 * ES3 only (ExtendScript): no JSON object, no Array.prototype.map/forEach/indexOf.
 */

var LS_TICKS = 254016000000;

function ls_json(v) {
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
    for (var j = 0; j < v.length; j++) a.push(ls_json(v[j]));
    return '[' + a.join(',') + ']';
  }
  var parts = [];
  for (var k in v) if (v.hasOwnProperty(k) && typeof v[k] !== 'function') parts.push(ls_json(k) + ':' + ls_json(v[k]));
  return '{' + parts.join(',') + '}';
}

function ls_err(e) { return ls_json({ ok: false, error: String(e && e.message ? e.message : e) }); }
function ls_ok(o) { o = o || {}; o.ok = true; return ls_json(o); }
function ls_time(sec) { var t = new Time(); t.seconds = sec; return t; }
function ls_sec(t) { try { return t.seconds; } catch (e) { return Number(t) / LS_TICKS; } }
function ls_norm(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

// ------------------------------------------------------------------ project tree

function ls_isBin(it) { return it.type === ProjectItemType.BIN; }

function ls_isMediaClip(it) {
  if (ls_isBin(it)) return false;
  try { if (it.isSequence && it.isSequence()) return false; } catch (e) {}
  var p = '';
  try { p = it.getMediaPath(); } catch (e2) {}
  return !!p;
}

// fn(item, binPath) for every non-bin item, recursively.
function ls_walk(bin, path, fn) {
  for (var i = 0; i < bin.children.numItems; i++) {
    var c = bin.children[i];
    if (ls_isBin(c)) ls_walk(c, path ? path + ' / ' + c.name : c.name, fn);
    else fn(c, path);
  }
}

function ls_findByNode(nodeId) {
  var found = null;
  ls_walk(app.project.rootItem, '', function (it) { if (!found && it.nodeId === nodeId) found = it; });
  return found;
}

function ls_findByPath(bin, path) {
  var want = ls_norm(path), found = null;
  ls_walk(bin, '', function (it) { try { if (!found && ls_norm(it.getMediaPath()) === want) found = it; } catch (e) {} });
  return found;
}

function ls_bin(name, parent) {
  parent = parent || app.project.rootItem;
  for (var i = 0; i < parent.children.numItems; i++) {
    var c = parent.children[i];
    if (ls_isBin(c) && c.name === name) return c;
  }
  var b = parent.createBin(name);
  if (b) return b;
  for (var j = 0; j < parent.children.numItems; j++) {
    var d = parent.children[j];
    if (ls_isBin(d) && d.name === name) return d;
  }
  return parent;
}

function ls_markers(coll) {
  var out = [];
  try {
    var m = coll.getFirstMarker();
    while (m) {
      var color = -1;
      try { color = m.getColorByIndex(); } catch (e) {}
      out.push({ name: m.name, comment: m.comments, start: ls_sec(m.start), end: ls_sec(m.end), color: color });
      m = coll.getNextMarker(m);
    }
  } catch (e2) {}
  return out;
}

function ls_label(it) { try { return it.getColorLabel(); } catch (e) { return -1; } }

function ls_itemInfo(it, bin, withMarkers) {
  var o = { name: it.name, nodeId: it.nodeId, bin: bin || '', label: ls_label(it), mediaPath: '' };
  try { o.mediaPath = it.getMediaPath(); } catch (e) {}
  try { o.hasProxy = !!it.hasProxy(); } catch (e2) { o.hasProxy = false; }
  if (withMarkers) {
    var all = ls_markers(it.getMarkers()), top = [];
    for (var i = 0; i < all.length; i++) if (all[i].name && all[i].name.charAt(0) === '⭐') top.push(all[i]);
    o.markerCount = all.length;
    o.top = top;
  }
  return o;
}

// ------------------------------------------------------------------ context

function ls_seqInfo(seq) {
  if (!seq) return null;
  var o = { id: seq.sequenceID, name: seq.name, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: 30, duration: 0, player: 0, inPoint: 0, outPoint: 0 };
  try { o.fps = LS_TICKS / Number(seq.timebase); } catch (e) {}
  try { o.duration = Number(seq.end) / LS_TICKS; } catch (e2) {}
  try { o.player = seq.getPlayerPosition().seconds; } catch (e3) {}
  try { o.inPoint = seq.getInPointAsTime().seconds; o.outPoint = seq.getOutPointAsTime().seconds; }
  catch (e4) { try { o.inPoint = Number(seq.getInPoint()); o.outPoint = Number(seq.getOutPoint()); } catch (e5) {} }
  return o;
}

function ls_context() {
  try {
    var p = app.project;
    return ls_ok({ version: app.version, project: { name: p.name, path: p.path }, seq: ls_seqInfo(p.activeSequence) });
  } catch (e) { return ls_err(e); }
}

function ls_setPlayer(seconds) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    seq.setPlayerPosition(String(Math.round(seconds * LS_TICKS)));
    return ls_ok();
  } catch (e) { return ls_err(e); }
}

function ls_save() {
  try { app.project.save(); return ls_ok({ path: app.project.path }); } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ dérush

// Clip open in the Source Monitor, or else the first item selected in the Project panel.
function ls_source() {
  try {
    var it = null, from = 'source', pos = null;
    try { it = app.sourceMonitor.getProjectItem(); } catch (e) {}
    if (it && !ls_isMediaClip(it)) it = null;
    if (!it) {
      from = 'selection';
      try {
        var sel = app.getCurrentProjectViewSelection();
        for (var i = 0; sel && i < sel.length; i++) if (ls_isMediaClip(sel[i])) { it = sel[i]; break; }
      } catch (e2) {}
    }
    if (!it) return ls_ok({ item: null });
    if (from === 'source') { try { pos = app.sourceMonitor.getPosition().seconds; } catch (e3) {} }
    var info = ls_itemInfo(it, '', true);
    info.markers = ls_markers(it.getMarkers());
    try { info.inPoint = it.getInPoint().seconds; info.outPoint = it.getOutPoint().seconds; } catch (e4) {}
    return ls_ok({ item: info, from: from, position: pos });
  } catch (e) { return ls_err(e); }
}

function ls_rate(nodeId, label) {
  try {
    var it = ls_findByNode(nodeId);
    if (!it) return ls_err('Clip introuvable.');
    it.setColorLabel(label);
    return ls_ok({ label: ls_label(it) });
  } catch (e) { return ls_err(e); }
}

// Marker on a project item; seconds = null -> current Source Monitor position.
function ls_clipMarker(nodeId, name, comment, color, seconds) {
  try {
    var it = ls_findByNode(nodeId);
    if (!it) return ls_err('Clip introuvable.');
    if (seconds === null || seconds === undefined) {
      try { seconds = app.sourceMonitor.getPosition().seconds; } catch (e) { return ls_err('Ouvre le clip dans le moniteur Source pour placer un marqueur.'); }
    }
    var m = it.getMarkers().createMarker(seconds);
    m.name = name;
    m.comments = comment || '';
    try { m.setColorByIndex(color); } catch (e2) {}
    return ls_ok({ start: seconds, markers: ls_markers(it.getMarkers()) });
  } catch (e) { return ls_err(e); }
}

function ls_openSource(nodeId) {
  try {
    var it = ls_findByNode(nodeId);
    if (!it) return ls_err('Clip introuvable.');
    app.sourceMonitor.openProjectItem(it);
    return ls_ok();
  } catch (e) { return ls_err(e); }
}

function ls_playSource(speed) {
  try { app.sourceMonitor.play(speed); return ls_ok(); } catch (e) { return ls_err(e); }
}

function ls_listClips(withMarkers) {
  try {
    var out = [];
    ls_walk(app.project.rootItem, '', function (it, bin) { if (ls_isMediaClip(it)) out.push(ls_itemInfo(it, bin, withMarkers)); });
    return ls_ok({ clips: out });
  } catch (e) { return ls_err(e); }
}

function ls_subclip(it, name, start, end) {
  var sc = null;
  try { sc = it.createSubClip(name, String(Math.round(start * LS_TICKS)), String(Math.round(end * LS_TICKS)), 0, 1, 1); } catch (e) {}
  if (!sc) { try { sc = it.createSubClip(name, ls_time(start), ls_time(end), 0, 1, 1); } catch (e2) {} }
  return sc;
}

function ls_binHas(bin, name) {
  for (var i = 0; i < bin.children.numItems; i++) if (bin.children[i].name === name) return true;
  return false;
}

/*
 * opts: { labels: [labelIndex], binName, top: { enabled, before, after, binName } }
 * Builds the SÉLECTS bin as subclips (originals stay where they are) and one subclip per ⭐ marker.
 */
function ls_makeSelects(opts) {
  try {
    var want = {}, i;
    for (i = 0; i < opts.labels.length; i++) want[opts.labels[i]] = true;
    var sel = null, top = null, made = 0, tops = 0, skipped = 0, failed = 0;
    var items = [];
    ls_walk(app.project.rootItem, '', function (it, bin) { if (ls_isMediaClip(it)) items.push({ it: it, bin: bin }); });
    for (i = 0; i < items.length; i++) {
      var it = items[i].it, bin = items[i].bin;
      if (bin === opts.binName || bin === opts.top.binName || bin.indexOf(opts.binName + ' /') === 0) continue;
      var inS = 0, outS = 0;
      try { inS = it.getInPoint().seconds; outS = it.getOutPoint().seconds; } catch (e) {}
      if (want[ls_label(it)]) {
        sel = sel || ls_bin(opts.binName);
        if (ls_binHas(sel, it.name)) skipped++;
        else {
          var sc = ls_subclip(it, it.name, inS, outS);
          if (sc) { sc.moveBin(sel); try { sc.setColorLabel(ls_label(it)); } catch (e1) {} made++; } else failed++;
        }
      }
      if (opts.top && opts.top.enabled) {
        var ms = ls_markers(it.getMarkers());
        for (var k = 0; k < ms.length; k++) {
          if (!ms[k].name || ms[k].name.charAt(0) !== '⭐') continue;
          top = top || ls_bin(opts.top.binName);
          var nm = ms[k].name + ' — ' + it.name;
          if (ls_binHas(top, nm)) { skipped++; continue; }
          var a = Math.max(inS, ms[k].start - opts.top.before), b = outS > 0 ? Math.min(outS, ms[k].start + opts.top.after) : ms[k].start + opts.top.after;
          var t = ls_subclip(it, nm, a, b);
          if (t) { t.moveBin(top); tops++; } else failed++;
        }
      }
    }
    return ls_ok({ selects: made, tops: tops, skipped: skipped, failed: failed });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ sequence markers

function ls_seqMarkers() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    return ls_ok({ markers: ls_markers(seq.markers), seq: ls_seqInfo(seq) });
  } catch (e) { return ls_err(e); }
}

function ls_startsWithAny(name, prefixes) {
  for (var i = 0; i < prefixes.length; i++) if (String(name).indexOf(prefixes[i]) === 0) return true;
  return false;
}

/*
 * Removes the sequence markers whose name starts with one of `prefixes`, then creates `list`
 * ([{ t, end, name, comment, color }]). Lets the panel re-sync its markers without duplicates.
 */
function ls_syncSeqMarkers(prefixes, list) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var coll = seq.markers, removed = 0;
    if (prefixes && prefixes.length) {
      var m = coll.getFirstMarker(), doomed = [];
      while (m) { if (ls_startsWithAny(m.name, prefixes)) doomed.push(m); m = coll.getNextMarker(m); }
      for (var i = 0; i < doomed.length; i++) { coll.deleteMarker(doomed[i]); removed++; }
    }
    for (var j = 0; j < list.length; j++) {
      var d = list[j], mk = coll.createMarker(d.t);
      mk.name = d.name;
      mk.comments = d.comment || '';
      if (d.end && d.end > d.t) { try { mk.end = ls_time(d.end); } catch (e) {} }
      try { mk.setColorByIndex(d.color); } catch (e2) {}
    }
    return ls_ok({ removed: removed, created: list.length });
  } catch (e) { return ls_err(e); }
}

function ls_renameSeqMarker(start, oldName, newName, color) {
  try {
    var coll = app.project.activeSequence.markers, m = coll.getFirstMarker();
    while (m) {
      if (Math.abs(ls_sec(m.start) - start) < 0.01 && m.name === oldName) {
        m.name = newName;
        if (color !== undefined && color !== null) { try { m.setColorByIndex(color); } catch (e) {} }
        return ls_ok();
      }
      m = coll.getNextMarker(m);
    }
    return ls_err('Marqueur introuvable.');
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ placing files (placeholders)

function ls_addVideoTrack(seq) {
  var before = seq.videoTracks.numTracks;
  app.enableQE();
  var qs = qe.project.getActiveSequence();
  try { qs.addTracks(1, before, 0, 1, 0, 0, 0); } catch (e) {}
  if (app.project.activeSequence.videoTracks.numTracks === before) { try { qs.addTracks(1, before, 0); } catch (e2) {} }
  return app.project.activeSequence.videoTracks.numTracks > before;
}

function ls_freeTrack(seq, first, start, end) {
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

/*
 * opts: { path, bin, seconds (duration), at (null = playhead), track (-1 = first free from V2), label }
 * Imports a file and overwrites it on a free video track: nothing already edited is touched.
 */
function ls_placeFile(opts) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var bin = ls_bin(opts.bin);
    app.project.importFiles([opts.path], true, bin, false);
    var item = ls_findByPath(bin, opts.path);
    if (!item) return ls_err('Import impossible : ' + opts.path);
    try { if (opts.label >= 0) item.setColorLabel(opts.label); } catch (e0) {}
    var at = opts.at === null || opts.at === undefined ? seq.getPlayerPosition().seconds : opts.at;
    var track = opts.track >= 0 ? opts.track : ls_freeTrack(seq, 1, at, at + opts.seconds);
    if (track < 0) {
      if (!ls_addVideoTrack(seq)) return ls_err('Impossible d\'ajouter une piste vidéo.');
      seq = app.project.activeSequence;
      track = seq.videoTracks.numTracks - 1;
    }
    try { seq.videoTracks[track].overwriteClip(item, ls_time(at)); }
    catch (e1) { seq.videoTracks[track].overwriteClip(item, at); }
    return ls_ok({ track: track, at: at, name: item.name });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ timeline selection

function ls_selectedClip() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var sel = seq.getSelection(), item = null;
    for (var i = 0; i < sel.length; i++) { if (sel[i].projectItem) { item = sel[i]; break; } }
    if (!item) return ls_err('Sélectionne un clip dans la timeline.');
    var path = '';
    try { path = item.projectItem.getMediaPath(); } catch (e) {}
    return ls_ok({
      name: item.name, nodeId: item.projectItem.nodeId, mediaType: item.mediaType, mediaPath: path,
      inPoint: item.inPoint.seconds, outPoint: item.outPoint.seconds, start: item.start.seconds, end: item.end.seconds
    });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ jump-cut

/*
 * New sequence holding only the given media ranges [[in, out], ...] (seconds) of a project item,
 * butted together. The original clip and sequence are untouched.
 */
function ls_jumpcut(nodeId, ranges, name) {
  try {
    var it = ls_findByNode(nodeId);
    if (!it) return ls_err('Clip introuvable dans le projet.');
    var bin = ls_bin('✂ JUMP-CUTS');
    var oldIn = 0, oldOut = 0;
    try { oldIn = it.getInPoint().seconds; oldOut = it.getOutPoint().seconds; } catch (e) {}
    var seq = app.project.createNewSequenceFromClips(name, [it], bin);
    if (!seq) return ls_err('Création de séquence impossible.');
    var t, c;
    for (t = 0; t < seq.videoTracks.numTracks; t++) while (seq.videoTracks[t].clips.numItems) seq.videoTracks[t].clips[0].remove(false, false);
    for (t = 0; t < seq.audioTracks.numTracks; t++) while (seq.audioTracks[t].clips.numItems) seq.audioTracks[t].clips[0].remove(false, false);
    var pos = 0, useVideo = true;
    for (c = 0; c < ranges.length; c++) {
      var a = ranges[c][0], b = ranges[c][1];
      it.setInPoint(a, 4);
      it.setOutPoint(b, 4);
      if (useVideo) {
        var before = seq.videoTracks[0].clips.numItems;
        try { seq.videoTracks[0].overwriteClip(it, ls_time(pos)); } catch (e1) {}
        if (seq.videoTracks[0].clips.numItems === before) useVideo = false; // audio-only media (voix off)
      }
      if (!useVideo) seq.audioTracks[0].overwriteClip(it, ls_time(pos));
      pos += b - a;
    }
    it.setInPoint(oldIn, 4);
    it.setOutPoint(oldOut, 4);
    try { app.project.openSequence(seq.sequenceID); } catch (e2) {}
    return ls_ok({ name: seq.name, duration: pos, cuts: ranges.length });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ audio

function ls_levelProp(clip) {
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      for (var j = 0; j < comp.properties.numItems; j++) {
        var p = comp.properties[j];
        if (p.displayName === 'Level' || p.displayName === 'Niveau') return p;
      }
    }
  } catch (e) {}
  return null;
}

function ls_audioClips() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var tracks = [];
    for (var t = 0; t < seq.audioTracks.numTracks; t++) {
      var tr = seq.audioTracks[t], clips = [];
      for (var c = 0; c < tr.clips.numItems; c++) {
        var cl = tr.clips[c], p = ls_levelProp(cl), level = null, kf = false, path = '';
        if (p) { try { level = p.getValue(); kf = p.isTimeVarying(); } catch (e) {} }
        try { path = cl.projectItem.getMediaPath(); } catch (e2) {}
        clips.push({ name: cl.name, nodeId: cl.nodeId, mediaPath: path, inPoint: cl.inPoint.seconds, outPoint: cl.outPoint.seconds,
          start: cl.start.seconds, end: cl.end.seconds, level: level, keyframed: kf });
      }
      tracks.push({ index: t, name: tr.name, clips: clips });
    }
    return ls_ok({ tracks: tracks });
  } catch (e) { return ls_err(e); }
}

// list: [{ track, nodeId, level }] (level = raw Premiere value, see core.dbToLevel)
function ls_setLevels(list) {
  try {
    var seq = app.project.activeSequence, done = 0, missed = 0;
    for (var i = 0; i < list.length; i++) {
      var tr = seq.audioTracks[list[i].track], ok = false;
      for (var c = 0; tr && c < tr.clips.numItems; c++) {
        var cl = tr.clips[c];
        if (cl.nodeId !== list[i].nodeId) continue;
        var p = ls_levelProp(cl);
        if (p && !p.isTimeVarying()) { p.setValue(list[i].level, true); ok = true; }
        break;
      }
      if (ok) done++; else missed++;
    }
    return ls_ok({ done: done, missed: missed });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ shorts

function ls_createShort(name, reframe) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var info = ls_seqInfo(seq);
    if (!(info.outPoint > info.inPoint) || (info.inPoint <= 0 && info.outPoint >= info.duration - 0.01)) {
      return ls_err('Pose un point d\'entrée (I) et de sortie (O) autour du moment à transformer en Short.');
    }
    var sub = seq.createSubsequence(true);
    if (!sub) return ls_err('Sous-séquence impossible.');
    sub.name = name;
    var out = sub, reframed = false;
    if (reframe) {
      try {
        var r = sub.autoReframeSequence(9, 16, 'default', name + ' — 9x16', false);
        if (r) { out = r; reframed = true; }
      } catch (e) {}
    }
    try { app.project.openSequence(out.sequenceID); } catch (e2) {}
    return ls_ok({ name: out.name, duration: info.outPoint - info.inPoint, reframed: reframed });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ proxies

function ls_mediaItems(scope) {
  try {
    var out = [], seen = {};
    var add = function (it, bin) {
      if (seen[it.nodeId] || !ls_isMediaClip(it)) return;
      seen[it.nodeId] = true;
      out.push(ls_itemInfo(it, bin, false));
    };
    if (scope === 'selection') {
      var sel = app.getCurrentProjectViewSelection() || [];
      for (var i = 0; i < sel.length; i++) {
        if (ls_isBin(sel[i])) ls_walk(sel[i], sel[i].name, add);
        else add(sel[i], '');
      }
    } else {
      ls_walk(app.project.rootItem, '', add);
    }
    return ls_ok({ items: out });
  } catch (e) { return ls_err(e); }
}

function ls_attachProxy(nodeId, path) {
  try {
    var it = ls_findByNode(nodeId);
    if (!it) return ls_err('Clip introuvable.');
    var r = it.attachProxy(path, 0);
    return ls_ok({ attached: r !== false, hasProxy: !!it.hasProxy() });
  } catch (e) { return ls_err(e); }
}

// ------------------------------------------------------------------ final check

function ls_audit() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return ls_err('Aucune séquence active.');
    var video = [], audio = [], t, c;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
      var vt = seq.videoTracks[t], muted = false;
      try { muted = vt.isMuted(); } catch (e) {}
      for (c = 0; c < vt.clips.numItems; c++) {
        var cl = vt.clips[c], path = '', dis = false;
        try { path = cl.projectItem.getMediaPath(); } catch (e1) {}
        try { dis = !!cl.disabled; } catch (e2) {}
        video.push({ track: t, trackMuted: muted, name: cl.name, start: cl.start.seconds, end: cl.end.seconds, mediaPath: path, disabled: dis });
      }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
      var at = seq.audioTracks[t];
      for (c = 0; c < at.clips.numItems; c++) {
        var ac = at.clips[c], ap = '';
        try { ap = ac.projectItem.getMediaPath(); } catch (e3) {}
        audio.push({ track: t, name: ac.name, start: ac.start.seconds, end: ac.end.seconds, mediaPath: ap });
      }
    }
    return ls_ok({ seq: ls_seqInfo(seq), video: video, audio: audio, markers: ls_markers(seq.markers), projectPath: app.project.path });
  } catch (e) { return ls_err(e); }
}
