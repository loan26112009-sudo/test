// Runs host/studio.jsx (unchanged ExtendScript) against the simulated Premiere project.
// Run: node tests/studio-host.test.js
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { studio } = require('./sim/scenarios.js');
const C = require('../extension/studio/js/core/core.js');
const media = require('./sim/media.js');
let fail = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-host-'));
const m = media.make(tmp);
const pr = studio({ media: m, projectPath: path.join(tmp, 'Projet.prproj') });
const call = (fn, ...args) => JSON.parse(pr.evalScript(fn + '(' + args.map(a => JSON.stringify(a)).join(',') + ')'));

const ctx = call('ls_context');
check(ctx.ok && ctx.seq.name === 'Montage — Le sourd' && ctx.seq.width === 3840 && Math.abs(ctx.seq.duration - 16) < 1e-6 && ctx.seq.fps === 30, 'context: ' + JSON.stringify(ctx.seq));

// dérush
let src = call('ls_source');
check(src.ok && src.item.name === 'face-cam.mov' && src.from === 'source' && src.position === 2, 'source monitor clip + position');
check(call('ls_rate', src.item.nodeId, 13).label === 13, 'rate A -> label 13');
const mk = call('ls_clipMarker', src.item.nodeId, '⭐ intro possible', 'note', 4, null);
check(mk.ok && mk.start === 2 && mk.markers.length === 1 && mk.markers[0].color === 4, 'TOP marker at source position');
const list = call('ls_listClips', true);
check(list.clips.length === 6 && list.clips.find(c => c.name === 'face-cam.mov').top.length === 1 && list.clips.find(c => c.name === 'face-cam.mov').bin === 'RUSHS / Jour 1', 'list clips with bins and ⭐ markers');
call('ls_rate', list.clips.find(c => c.name === 'broll-paris.mov').nodeId, 13);
call('ls_rate', list.clips.find(c => c.name === 'broll-cuisine.mov').nodeId, 15);
const sel = call('ls_makeSelects', { labels: [13], binName: 'SÉLECTS', top: { enabled: true, before: 2, after: 3, binName: '⭐ TOP' } });
const selBin = pr.findBin('SÉLECTS'), topBin = pr.findBin('⭐ TOP');
check(sel.selects === 2 && sel.tops === 1 && selBin._kids.length === 2 && topBin._kids.length === 1 && topBin._kids[0]._in === 0 && topBin._kids[0]._out === 5, 'SÉLECTS (2 subclips) + ⭐ TOP subclip 0→5 s: ' + JSON.stringify(sel));
check(pr.items.day1._kids.length === 3, 'originals stay in their bins');
const again = call('ls_makeSelects', { labels: [13], binName: 'SÉLECTS', top: { enabled: true, before: 2, after: 3, binName: '⭐ TOP' } });
check(again.selects === 0 && again.skipped === 3 && selBin._kids.length === 2, 'running it again creates no duplicates');
check(call('ls_openSource', list.clips[1].nodeId).ok && pr.log.opened.slice(-1)[0] === list.clips[1].name, 'open next clip in Source Monitor');
call('ls_playSource', 2); check(pr.log.played[0] === 2, 'play source at x2');

// structure markers
let r = call('ls_syncSeqMarkers', ['[SEG]', '[LOOP]'], [{ t: 0, end: 10, name: '[SEG] Intro', comment: 'Curiosité', color: 6 }, { t: 2, end: 14, name: '[LOOP] Va-t-il tenir ?', color: 2 }]);
check(r.created === 2, 'segments + loops markers created');
call('ls_syncSeqMarkers', [], [{ t: 7, name: '[FB] trop long', color: 3 }]);
r = call('ls_syncSeqMarkers', ['[SEG]', '[LOOP]'], [{ t: 0, end: 12, name: '[SEG] Intro v2', color: 6 }]);
let sm = call('ls_seqMarkers').markers;
check(r.removed === 2 && sm.length === 2 && sm[0].name === '[SEG] Intro v2' && sm[0].end === 12 && sm[1].name === '[FB] trop long', 're-sync replaces only its own markers (feedback kept)');
check(call('ls_renameSeqMarker', 7, '[FB] trop long', '[OK] trop long', 0).ok && call('ls_seqMarkers').markers[1].name === '[OK] trop long', 'feedback marked as done');

// placeholder: overwrite on first free track above V1 at the playhead (3 s), V2 empty -> V2
const ph = path.join(tmp, 'ph.mp4');
cp.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=320x180:d=3', '-f', 'lavfi', '-i', 'anullsrc', '-shortest', ph]);
r = call('ls_placeFile', { path: ph, bin: 'PLACEHOLDERS', seconds: 3, at: null, track: -1, label: 1 });
check(r.ok && r.track === 1 && r.at === 3 && pr.items.seq._v[0]._clips.length === 2, 'placeholder on V2 at playhead, V1 untouched: ' + JSON.stringify(r));
r = call('ls_placeFile', { path: ph, bin: 'PLACEHOLDERS', seconds: 3, at: 4, track: -1, label: 1 });
check(r.ok && r.track === 2 && pr.log.addTracks === 1, 'overlapping placeholder goes to a new track V3');

// jump-cut
const selClip = call('ls_selectedClip');
check(selClip.ok && selClip.name === 'face-cam.mov' && selClip.outPoint === 10, 'timeline selection');
r = call('ls_jumpcut', selClip.nodeId, [[0, 2.1], [2.9, 7.1]], 'face-cam — sans blancs');
const js = pr.app.project.activeSequence;
check(r.ok && js.name === 'face-cam — sans blancs' && js._v[0]._clips.length === 2 && Math.abs(js._v[0]._clips[1].start.seconds - 2.1) < 1e-9 && Math.abs(Number(js.end) / 254016000000 - 6.3) < 1e-6, 'jump-cut sequence: 2 parts butted, 6.3 s');
check(pr.items.talk._in === 0 && pr.items.talk._out === pr.items.talk.duration, 'source clip in/out restored');
const voCut = call('ls_jumpcut', pr.items.vo.nodeId, [[0, 1], [2, 3]], 'VO — sans blancs');
check(voCut.ok && pr.app.project.activeSequence._a[0]._clips.length === 2 && pr.app.project.activeSequence._v[0]._clips.length === 0, 'audio-only VO goes on A1');
pr.app.project.activeSequence = pr.items.seq;

// audio
const ac = call('ls_audioClips');
check(ac.tracks.length === 3 && ac.tracks[0].clips[0].name === 'voix-off.wav' && Math.abs(C.levelToDb(ac.tracks[0].clips[0].level)) < 1e-9, 'audio clips with levels (0 dB)');
r = call('ls_setLevels', [{ track: 1, nodeId: ac.tracks[1].clips[0].nodeId, level: C.dbToLevel(-12) }]);
check(r.done === 1 && Math.abs(C.levelToDb(pr.levelProp(pr.items.seq._a[1]._clips[0]).getValue()) + 12) < 1e-9, 'music gain set to −12 dB');
pr.levelProp(pr.items.seq._a[2]._clips[0])._setKeyframed(true);
r = call('ls_setLevels', [{ track: 2, nodeId: ac.tracks[2].clips[0].nodeId, level: 1 }]);
check(r.done === 0 && r.missed === 1, 'keyframed clip volume left alone');

// short
r = call('ls_createShort', 'SHORT — test', true);
check(!r.ok && /point d'entrée/.test(r.error), 'short refuses without in/out');
pr.items.seq._in = 1; pr.items.seq._out = 4;
r = call('ls_createShort', 'SHORT — test', true);
const sh = pr.app.project.activeSequence;
check(r.ok && r.reframed && sh.frameSizeVertical === 1920 && Math.abs(Number(sh.end) / 254016000000 - 3) < 1e-6, 'short: 3 s sub-sequence reframed to 9:16 and opened');
pr.app.project.activeSequence = pr.items.seq;

// proxies
pr.select([pr.items.day1]);
let mi = call('ls_mediaItems', 'selection');
check(mi.items.length === 3 && mi.items.every(i => !i.hasProxy), 'selected bin -> 3 clips without proxy');
r = call('ls_attachProxy', mi.items[0].nodeId, ph);
check(r.ok && r.hasProxy, 'proxy attached');
check(call('ls_mediaItems', 'all').items.length >= 9, 'all media items (incl. subclips/placeholders)');

// audit + save
const au = call('ls_audit');
check(au.ok && au.video.some(v => /ph\.mp4$/.test(v.mediaPath)) && au.markers.length === 2 && au.audio.length === 3, 'audit lists clips, placeholders and markers');
check(call('ls_save').ok && pr.log.saved === 1, 'project saved');
check(call('ls_setPlayer', 12).ok && pr.items.seq._player === 12, 'move playhead');
process.exit(fail ? 1 : 0);
