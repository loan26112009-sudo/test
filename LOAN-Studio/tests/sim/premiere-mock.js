/*
 * Simulated Premiere Pro scripting DOM — enough of the real API to run host/reframe.jsx and
 * host/studio.jsx unchanged in a Node vm. It models what the scripts rely on: project bins and
 * clips (labels, markers, in/out, proxies, subclips), sequences (tracks, clips, markers, in/out,
 * player, sub-sequences, auto reframe), the Source Monitor, audio clip volume and QE track adds.
 */
const vm = require('vm');
const fs = require('fs');
const pathMod = require('path');
const TICKS = 254016000000;
const CLIP = 1, BIN = 2, ROOT = 3;

function T(sec) { return { seconds: sec, ticks: String(Math.round(sec * TICKS)) }; }
function secOf(x) {
  if (x && typeof x === 'object') return x.seconds;
  if (typeof x === 'string') return Number(x) / TICKS;
  return +x;
}
function coll(getArr, countName) {
  const o = {};
  Object.defineProperty(o, countName, { get: () => getArr().length });
  for (let i = 0; i < 256; i++) Object.defineProperty(o, i, { get: () => getArr()[i] });
  return o;
}

let nodeCounter = 1000;
const nextNode = () => (nodeCounter++).toString(16).padStart(8, '0');

function markerCollection() {
  const arr = [];
  const sorted = () => arr.slice().sort((a, b) => a.start.seconds - b.start.seconds);
  return {
    _arr: arr,
    get numMarkers() { return arr.length; },
    createMarker(sec) {
      let color = 0;
      const m = { name: '', comments: '', type: 'Comment', start: T(sec), end: T(sec),
        setColorByIndex(i) { color = i; }, getColorByIndex() { return color; } };
      arr.push(m); return m;
    },
    getFirstMarker() { return sorted()[0]; },
    getNextMarker(m) { const s = sorted(); const i = s.indexOf(m); return s[i + 1]; },
    deleteMarker(m) { const i = arr.indexOf(m); if (i >= 0) arr.splice(i, 1); }
  };
}

function createPremiere(opts) {
  const log = { imported: [], placed: [], setPlayer: [], addTracks: 0, evalCount: 0, opened: [], played: [], attached: [], saved: 0, levels: [] };
  const probeDur = opts.probeDuration || (() => 5);

  function projectItem(name, mediaPath, duration, extra) {
    const it = Object.assign({
      name, nodeId: nextNode(), type: CLIP, mediaPath, duration, _label: 0, _in: 0, _out: duration, _proxy: null, _markers: markerCollection(), parent: null, _isSeq: false,
      getMediaPath() { return this.mediaPath; },
      getColorLabel() { return this._label; }, setColorLabel(i) { this._label = i; },
      getMarkers() { return this._markers; },
      getInPoint() { return T(this._in); }, getOutPoint() { return T(this._out); },
      setInPoint(s) { this._in = secOf(s); }, setOutPoint(s) { this._out = secOf(s); },
      hasProxy() { return !!this._proxy; },
      attachProxy(p) { if (!fs.existsSync(p)) return false; this._proxy = p; log.attached.push({ name: this.name, path: p }); return true; },
      isSequence() { return this._isSeq; },
      createSubClip(n, a, b) {
        const s = projectItem(n, this.mediaPath, this.duration);
        s._in = secOf(a); s._out = secOf(b); s._subOf = this.nodeId;
        this.parent._add(s); return s;
      },
      moveBin(bin) { if (this.parent) this.parent._remove(this); bin._add(this); }
    }, extra || {});
    return it;
  }
  function bin(name, type) {
    const kids = [];
    return { name, type: type || BIN, nodeId: nextNode(), parent: null, _kids: kids,
      get children() { return coll(() => kids, 'numItems'); },
      _add(it) { it.parent = this; kids.push(it); }, _remove(it) { const i = kids.indexOf(it); if (i >= 0) kids.splice(i, 1); },
      createBin(n) { const b = bin(n); this._add(b); return b; } };
  }

  function levelProp(initDb) {
    let v = Math.pow(10, (initDb - 15) / 20), tv = false;
    return { displayName: 'Level', getValue() { return v; }, setValue(x) { v = x; log.levels.push(x); }, isTimeVarying() { return tv; }, _setKeyframed(b) { tv = b; } };
  }
  function trackItem(pi, start, inPoint, outPoint, mediaType) {
    const comps = mediaType === 'Audio'
      ? [{ displayName: 'Volume', properties: coll(() => this_props, 'numItems') }]
      : [];
    const this_props = mediaType === 'Audio' ? [{ displayName: 'Bypass', getValue() { return false; }, isTimeVarying() { return false; } }, levelProp(0)] : [];
    return { name: pi.name, nodeId: nextNode(), mediaType: mediaType || 'Video', projectItem: pi, disabled: false,
      start: T(start), end: T(start + outPoint - inPoint), inPoint: T(inPoint), outPoint: T(outPoint),
      get components() { return coll(() => comps, 'numItems'); },
      getSpeed() { return 1; }, isSpeedReversed() { return false; },
      remove() { if (this._track) this._track._remove(this); } };
  }
  function track(name, kind) {
    const clips = [];
    return { name, _kind: kind, _clips: clips,
      get clips() { return coll(() => clips.slice().sort((a, b) => a.start.seconds - b.start.seconds), 'numItems'); },
      isLocked() { return false; }, isMuted() { return false; },
      _remove(c) { const i = clips.indexOf(c); if (i >= 0) clips.splice(i, 1); },
      _put(item, start, mediaType) {
        const ti = trackItem(item, start, item._in, item._out, mediaType); ti._track = this;
        const end = ti.end.seconds;
        for (let i = clips.length - 1; i >= 0; i--) if (clips[i].start.seconds < end - 1e-9 && clips[i].end.seconds > start + 1e-9) clips.splice(i, 1);
        clips.push(ti); return ti;
      },
      overwriteClip(item, time) {
        if (this._kind === 'video' && item._audioOnly) return;
        const start = secOf(time);
        const ti = this._put(item, start, this._kind === 'video' ? 'Video' : 'Audio');
        log.placed.push({ seq: this._seq && this._seq.name, track: this._seq ? this._seq._v.indexOf(this) : -1, kind: this._kind, start, end: ti.end.seconds, name: item.name, path: item.mediaPath });
        if (this._kind === 'video' && item._hasAudio && this._seq) { const a = this._seq._a[this._seq._v.indexOf(this)] || this._seq._a[0]; if (a) a._put(item, start, 'Audio'); }
      }
    };
  }
  function sequence(name, w, h, fps) {
    const s = { sequenceID: 'seq-' + nextNode(), name, frameSizeHorizontal: w, frameSizeVertical: h, timebase: String(TICKS / fps),
      _v: [], _a: [], markers: markerCollection(), _player: 0, _in: 0, _out: null, _selection: [],
      get videoTracks() { return coll(() => this._v, 'numTracks'); },
      get audioTracks() { return coll(() => this._a, 'numTracks'); },
      get end() { let e = 0; this._v.concat(this._a).forEach(t => t._clips.forEach(c => { e = Math.max(e, c.end.seconds); })); return String(Math.round(e * TICKS)); },
      getSelection() { return this._selection; },
      getPlayerPosition() { return T(this._player); }, setPlayerPosition(t) { this._player = secOf(t); log.setPlayer.push(this._player); },
      getInPointAsTime() { return T(this._in); }, getOutPointAsTime() { return T(this._out === null ? Number(this.end) / TICKS : this._out); },
      createSubsequence() {
        const sub = sequence(this.name + ' Subsequence', w, h, fps), a = this._in, b = this._out;
        this._v.forEach(() => sub._addTrack('video')); this._a.forEach(() => sub._addTrack('audio'));
        [['_v', 'Video'], ['_a', 'Audio']].forEach(([k, mt]) => this[k].forEach((t, i) => t._clips.forEach(c => {
          if (c.end.seconds <= a || c.start.seconds >= b) return;
          const cs = Math.max(a, c.start.seconds), ce = Math.min(b, c.end.seconds), off = cs - c.start.seconds;
          const pi = Object.assign(Object.create(c.projectItem), { _in: c.inPoint.seconds + off, _out: c.inPoint.seconds + off + ce - cs });
          sub[k][i]._put(pi, cs - a, mt);
        })));
        project._seqs.push(sub); return sub;
      },
      autoReframeSequence(n, d, preset, nm) {
        const r = this.createSubsequenceAll(); r.name = nm; r.frameSizeHorizontal = 1080; r.frameSizeVertical = 1920; r._reframedFrom = this.name; return r;
      },
      createSubsequenceAll() { const keep = [this._in, this._out]; this._in = 0; this._out = Number(this.end) / TICKS; const r = this.createSubsequence(); [this._in, this._out] = keep; return r; },
      _addTrack(kind) { const t = track((kind === 'video' ? 'Video ' : 'Audio ') + ((kind === 'video' ? this._v : this._a).length + 1), kind); t._seq = this; (kind === 'video' ? this._v : this._a).push(t); return t; }
    };
    return s;
  }

  const root = bin('root', ROOT);
  const project = { _seqs: [] };

  function importFile(p, target) {
    const it = projectItem(pathMod.basename(p), p, probeDur(p));
    it._hasAudio = opts.probeAudio ? opts.probeAudio(p) : false;
    target._add(it); log.imported.push(p); return it;
  }

  const sourceMonitor = { _item: null, _pos: 0,
    getProjectItem() { return this._item; }, getPosition() { return T(this._pos); },
    openProjectItem(it) { this._item = it; this._pos = 0; log.opened.push(it.name); }, play(speed) { log.played.push(speed); } };

  const app = {
    version: '25.0.0', enableQE() {},
    project: {
      name: 'Projet.prproj', path: opts.projectPath || '/tmp/Projet.prproj', rootItem: root, activeSequence: null,
      importFiles(paths, suppress, target) { paths.forEach(p => importFile(p, target || root)); return true; },
      save() { log.saved++; if (opts.projectPath) fs.writeFileSync(opts.projectPath, 'saved ' + log.saved); },
      createNewSequenceFromClips(name, items, b) {
        const it = items[0], s = sequence(name, 1920, 1080, 30);
        s._addTrack('video'); s._addTrack('audio');
        s._v[0]._put(it, 0, 'Video'); s._a[0]._put(it, 0, 'Audio');
        const pi = projectItem(name, '', 0, { _isSeq: true }); (b || root)._add(pi);
        project._seqs.push(s); return s;
      },
      openSequence(id) { const s = project._seqs.find(x => x.sequenceID === id); if (s) app.project.activeSequence = s; log.opened.push('seq:' + (s && s.name)); return !!s; }
    },
    sourceMonitor,
    getCurrentProjectViewSelection() { return opts.viewSelection ? opts.viewSelection() : []; }
  };
  const sandbox = {
    ProjectItemType: { CLIP, BIN, ROOT, FILE: 4 },
    Time: function () { this.seconds = 0; },
    app,
    qe: { project: { getActiveSequence() { return { addTracks(nv) { for (let i = 0; i < nv; i++) app.project.activeSequence._addTrack('video'); log.addTracks++; } }; } } }
  };
  const ctx = vm.createContext(sandbox);
  (Array.isArray(opts.jsx) ? opts.jsx : [opts.jsx]).forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: pathMod.basename(f) }));

  const api = {
    log, app, root, project, sourceMonitor,
    bin(name, parent) { const b = bin(name); (parent || root)._add(b); return b; },
    clip(name, mediaPath, duration, parent, extra) { const it = projectItem(name, mediaPath, duration, extra); (parent || root)._add(it); return it; },
    sequence(name, w, h, fps, nv, na) {
      const s = sequence(name, w, h, fps);
      for (let i = 0; i < nv; i++) s._addTrack('video');
      for (let i = 0; i < na; i++) s._addTrack('audio');
      project._seqs.push(s);
      const pi = projectItem(name, '', 0, { _isSeq: true }); root._add(pi);
      return s;
    },
    place(seq, kind, trackIdx, item, start, mediaType) { return (kind === 'video' ? seq._v : seq._a)[trackIdx]._put(item, start, mediaType || (kind === 'video' ? 'Video' : 'Audio')); },
    levelProp(ti) { return ti.components[0].properties[1]; },
    movePlayer(sec) { if (app.project.activeSequence) app.project.activeSequence._player = sec; },
    findBin(name) { return root._kids.find(k => k.type === BIN && k.name === name); },
    evalScript(script) { log.evalCount++; return String(vm.runInContext(script, ctx)); }
  };
  return api;
}

module.exports = { createPremiere, TICKS };
