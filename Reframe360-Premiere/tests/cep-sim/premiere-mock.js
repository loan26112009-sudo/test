/*
 * Minimal Premiere Pro scripting DOM, enough to run host/premiere.jsx unchanged in a Node vm.
 * Timeline: V1 = the 360 clip, V2 = a B-roll clip overlapping it (must never be overwritten).
 */
const vm = require('vm');
const TICKS = 254016000000;

function list(arr, countName) {
  const o = {};
  Object.defineProperty(o, countName, { get: () => arr.length });
  for (let i = 0; i < 64; i++) Object.defineProperty(o, i, { get: () => arr[i] });
  return o;
}
function T(sec) { return { seconds: sec, ticks: String(Math.round(sec * TICKS)) }; }

function createPremiere(opts) {
  const log = { imported: [], placed: [], setPlayer: [], addTracks: 0, evalCount: 0 };
  const items = [];
  function projectItem(name, mediaPath, duration) {
    return { name, type: 1, mediaPath, duration, getMediaPath() { return mediaPath; } };
  }
  function trackItem(name, pi, start, end, inPoint, nodeId) {
    return {
      name, nodeId, mediaType: 'Video', projectItem: pi, disabled: false,
      start: T(start), end: T(end), inPoint: T(inPoint), outPoint: T(inPoint + end - start),
      getSpeed() { return 1; }, isSpeedReversed() { return false; }
    };
  }
  function track(clips) {
    return { _clips: clips, get clips() { return list(this._clips, 'numItems'); }, isLocked() { return false; },
      overwriteClip(item, time) {
        const start = typeof time === 'object' ? time.seconds : +time;
        const end = start + item.duration;
        this._clips = this._clips.filter(c => !(c.start.seconds < end && c.end.seconds > start));
        this._clips.push(trackItem(item.name, item, start, end, 0, 'n' + Math.random()));
        log.placed.push({ track: tracks.indexOf(this), start, end, path: item.mediaPath });
      } };
  }
  const src = projectItem('clip360.mp4', opts.mediaPath, 4);
  const broll = projectItem('broll.mp4', '/tmp/broll.mp4', 10);
  const clip360 = trackItem('clip360.mp4', src, opts.start, opts.start + (opts.outPoint - opts.inPoint), opts.inPoint, '000f4240');
  const tracks = [track([clip360]), track([trackItem('broll.mp4', broll, opts.start - 1, opts.start + 1, 0, '000f4241')])];
  let player = opts.player;
  const seq = {
    sequenceID: 'seq-uuid-1', name: 'Montage', frameSizeHorizontal: 1920, frameSizeVertical: 1080,
    timebase: String(TICKS / 30),
    get videoTracks() { return list(tracks, 'numTracks'); },
    getSelection() { return [clip360]; },
    getPlayerPosition() { return T(player); },
    setPlayerPosition(ticks) { player = Number(ticks) / TICKS; log.setPlayer.push(player); }
  };
  const bins = [];
  const rootItem = {
    get children() { return list(bins, 'numItems'); },
    createBin(name) {
      const b = { name, type: 2, _c: [], get children() { return list(this._c, 'numItems'); } };
      bins.push(b); return b;
    }
  };
  const sandbox = {
    ProjectItemType: { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 },
    Time: function () { this.seconds = 0; },
    app: {
      version: '25.0.0', enableQE() {},
      project: {
        path: '/tmp/projet.prproj', activeSequence: seq, rootItem,
        importFiles(paths, suppress, bin) {
          paths.forEach(p => { const it = projectItem(require('path').basename(p), p, opts.outPoint - opts.inPoint); bin._c.push(it); log.imported.push(p); });
          return true;
        }
      }
    },
    qe: { project: { getActiveSequence() { return { addTracks(nv) { for (let i = 0; i < nv; i++) tracks.push(track([])); log.addTracks++; } }; } } }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(require('fs').readFileSync(opts.jsx, 'utf8'), ctx, { filename: 'premiere.jsx' });
  return {
    log, clip360, tracks,
    movePlayer(sec) { player = sec; },
    evalScript(script) { log.evalCount++; return String(vm.runInContext(script, ctx)); }
  };
}
module.exports = { createPremiere };
