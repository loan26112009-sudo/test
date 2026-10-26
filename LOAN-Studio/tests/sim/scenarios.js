// Project set-ups for the simulated Premiere (used by preload.js and the Node host tests).
const cp = require('child_process');
const path = require('path');
const { createPremiere } = require('./premiere-mock.js');

function probe(p) {
  try {
    const j = JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p]).toString());
    return { duration: +j.format.duration || 5, audio: j.streams.some(s => s.codec_type === 'audio'), video: j.streams.some(s => s.codec_type === 'video') };
  } catch (e) { return { duration: 5, audio: false, video: true }; }
}

const HOST = path.join(__dirname, '..', '..', 'extension', 'host');

// Reframe 360: 360 clip on V1 (10 s → 12 s, source 1 → 3 s), B-roll on V2 overlapping it.
function reframe(cfg) {
  const pr = createPremiere({ jsx: path.join(HOST, 'reframe.jsx'), projectPath: cfg.projectPath,
    probeDuration: p => probe(p).duration, probeAudio: p => probe(p).audio });
  const seq = pr.sequence('Montage', 1920, 1080, 30, 2, 1);
  seq.sequenceID = 'seq-uuid-1';
  const src = pr.clip('clip360.mp4', cfg.mediaPath, 4);
  src._in = cfg.inPoint; src._out = cfg.outPoint;
  const ti = pr.place(seq, 'video', 0, src, cfg.start);
  const broll = pr.clip('broll.mp4', '/tmp/broll.mp4', 10); broll._in = 0; broll._out = 2;
  pr.place(seq, 'video', 1, broll, cfg.start - 1);
  seq._selection = [ti];
  seq._player = cfg.player;
  pr.app.project.activeSequence = seq;
  pr.clip360 = ti;
  pr.tracks = seq._v;
  return pr;
}

/*
 * LOAN Studio: a YouTube project with rushes in bins, a VO, music and SFX on the timeline.
 * cfg.media: { talk, broll, music, sfx, vo } real files (talk has speech + blanks).
 */
function studio(cfg) {
  let selection = [];
  const pr = createPremiere({ jsx: path.join(HOST, 'studio.jsx'), projectPath: cfg.projectPath,
    probeDuration: p => probe(p).duration, probeAudio: p => probe(p).audio, viewSelection: () => selection });
  const m = cfg.media;
  const rushes = pr.bin('RUSHS'), day1 = pr.bin('Jour 1', rushes), sons = pr.bin('SONS');
  const talk = pr.clip('face-cam.mov', m.talk, probe(m.talk).duration, day1);
  const broll = pr.clip('broll-paris.mov', m.broll, probe(m.broll).duration, day1);
  const broll2 = pr.clip('broll-cuisine.mov', m.broll, probe(m.broll).duration, day1);
  const music = pr.clip('musique.wav', m.music, probe(m.music).duration, sons); music._audioOnly = true;
  const sfx = pr.clip('whoosh.wav', m.sfx, probe(m.sfx).duration, sons); sfx._audioOnly = true;
  const vo = pr.clip('voix-off.wav', m.vo, probe(m.vo).duration, sons); vo._audioOnly = true;
  [talk, broll, broll2].forEach(c => { c._hasAudio = true; });

  const seq = pr.sequence('Montage — Le sourd', 3840, 2160, 30, 2, 3);
  seq.sequenceID = 'seq-main';
  // V1: face-cam 0→10, gap 10→12, b-roll 12→16 ; A1: VO, A2: music, A3: sfx
  const tTalk = pr.place(seq, 'video', 0, talk, 0);
  broll._out = 4; pr.place(seq, 'video', 0, broll, 12); broll._out = broll.duration;
  pr.place(seq, 'audio', 0, vo, 0);
  pr.place(seq, 'audio', 1, music, 0);
  sfx._out = Math.min(sfx.duration, 1); pr.place(seq, 'audio', 2, sfx, 5); sfx._out = sfx.duration;
  seq._selection = [tTalk];
  seq._player = 3;
  pr.app.project.activeSequence = seq;
  pr.sourceMonitor._item = talk; pr.sourceMonitor._pos = 2.0;
  pr.items = { talk, broll, broll2, music, sfx, vo, seq, tTalk, rushes, day1 };
  pr.select = (arr) => { selection = arr; };
  return pr;
}

module.exports = { reframe, studio, probe };
