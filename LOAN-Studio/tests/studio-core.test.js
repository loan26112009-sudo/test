// Unit tests for LOAN Studio's pure logic. Run: node tests/studio-core.test.js
const assert = require('assert');
const C = require('../extension/studio/js/core/core.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('PASS ' + name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

t('parseTime formats', () => {
  near(C.parseTime('1:23'), 83); near(C.parseTime('01:02:03'), 3723); near(C.parseTime('83s'), 83);
  near(C.parseTime('4min10'), 250); near(C.parseTime('1h02m03s'), 3723); near(C.parseTime('0:00:01:15', 30), 1.5);
  assert.ok(isNaN(C.parseTime('abc'))); assert.ok(isNaN(C.parseTime('')));
});
t('fmtTime / fmtTC', () => {
  assert.strictEqual(C.fmtTime(83), '1:23'); assert.strictEqual(C.fmtTime(3723), '1:02:03');
  assert.strictEqual(C.fmtTC(1.5, 30), '00:00:01:15');
});
t('Loop Builder export import', () => {
  const txt = ['═══════════════════════════════════', 'LOOP BUILDER — NOTES', '═══════════════════════════════════',
    'Vidéo : J\'ai vécu 100h en VR', 'Durée : 15:00', '', '── CONCEPT ──', '[0:00→1:00] pas une boucle', '',
    '── BOUCLES PRINCIPALES ──', '  [0:00→14:30] Va-t-il tenir 100h ?', '',
    '── SOUS-BOUCLES ──', '  [0:40→2:10] Elliot ne le croit pas (étage 1)', '  [2:00→3:15] La douleur aux yeux (étage 2)', '',
    '── MARQUEURS ──', '  Twist à 6:12', '', '─ Exporté depuis LoopBuilder ─'].join('\n');
  const r = C.parseLoopBuilder(txt);
  assert.strictEqual(r.title, 'J\'ai vécu 100h en VR'); near(r.duration, 900);
  assert.strictEqual(r.loops.length, 3);
  assert.deepStrictEqual(r.loops[1], { label: 'Elliot ne le croit pas', start: 40, end: 130, level: 'micro', row: 1 });
  assert.strictEqual(r.loops[0].level, 'macro');
  assert.deepStrictEqual(r.markers, [{ label: 'Twist', t: 372 }]);
});
t('segments text import', () => {
  const s = C.parseSegments('Intro | 0:45 | Curiosité\nPhase 1 — Jeux 2:30\n- Cuisine (1:10)\nOutro');
  assert.deepStrictEqual(s.map(x => [x.name, x.duration, x.emotion]), [['Intro', 45, 'Curiosité'], ['Phase 1 — Jeux', 150, ''], ['Cuisine', 70, ''], ['Outro', 0, '']]);
  const l = C.layoutSegments(s);
  near(l[2].start, 195); near(l[2].end, 265);
});
t('feedback timestamps', () => {
  const f = C.parseFeedback('2:31 trop long\nà 4min10 le son sature\n12:05-12:40 coupe ça\n[1:02:03] super passage\npas de temps ici');
  assert.deepStrictEqual(f.map(x => [x.t, x.end, x.text]), [[151, null, 'trop long'], [250, null, 'le son sature'], [725, 760, 'coupe ça'], [3723, null, 'super passage']]);
  assert.ok(/son sature/.test(f[1].text));
});
t('retention map: gaps and overload', () => {
  const loops = [{ start: 0, end: 30 }, { start: 50, end: 100 }, { start: 60, end: 90 }, { start: 61, end: 89 }, { start: 62, end: 88 }];
  const r = C.retention(loops, 120, { minGap: 8 });
  const none = r.issues.filter(i => i.type === 'none'), many = r.issues.filter(i => i.type === 'many');
  assert.deepStrictEqual(none.map(i => [i.start, i.end]), [[30, 50], [100, 120]]);
  assert.deepStrictEqual(many.map(i => [i.start, i.end]), [[62, 88]]);
});
t('emotion contrast rule', () => {
  const e = C.emotionIssues([{ name: 'A', emotion: 'Tension' }, { name: 'B', emotion: 'tension' }, { name: 'C', emotion: 'Joie' }]);
  assert.strictEqual(e.length, 1); assert.strictEqual(e[0].index, 1);
});
t('YouTube chapters', () => {
  const c = C.chapters([{ name: 'Phase 1', start: 45 }, { name: 'Cuisine', start: 195 }, { name: 'Outro', start: 600 }]);
  assert.strictEqual(c.text, '0:00 Intro\n0:45 Phase 1\n3:15 Cuisine\n10:00 Outro');
  assert.ok(c.warnings.some(w => /Intro/.test(w)));
  assert.ok(C.chapters([{ name: 'a', start: 0 }, { name: 'b', start: 5 }, { name: 'c', start: 60 }]).warnings.some(w => /10 s/.test(w)));
});
t('silence detection -> speech segments', () => {
  const sil = C.parseSilences('[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 3.0 | silence_duration: 1.5\n[silencedetect] silence_start: 7.2\n[silencedetect] silence_end: 7.25\n[silencedetect] silence_start: 9.0\n');
  assert.strictEqual(sil.length, 3); assert.strictEqual(sil[2].end, Infinity);
  const k = C.speechSegments(sil, 10, 0.1, 0.25);
  assert.deepStrictEqual(k.map(x => [+x.start.toFixed(2), +x.end.toFixed(2)]), [[0, 1.6], [2.9, 9.1]]);
});
t('Premiere audio level conversion + gains', () => {
  near(C.dbToLevel(0), 0.17782794100389, 1e-12); near(C.levelToDb(C.dbToLevel(-6)), -6, 1e-9);
  assert.deepStrictEqual(C.gainFor(-20, -6), { gain: 14, clipped: false, silent: false });
  assert.deepStrictEqual(C.gainFor(-40, -6), { gain: 15, clipped: true, silent: false });
  assert.strictEqual(C.gainFor(-Infinity, -6).silent, true);
  assert.strictEqual(C.gainFor(-91, -6).silent, true);
});
t('ebur128 parsing', () => {
  const s = '[Parsed_ebur128_0] t: 0.4   TARGET:-23 LUFS    M: -30.1 S:-120.7     I: -30.1 LUFS\n[Parsed_ebur128_0] t: 3.0 M: -15.0 S: -16.2 I: -15.9 LUFS\n[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -15.4 LUFS\n    Threshold: -25.6 LUFS\n\n  Loudness range:\n    LRA:         6.2 LU\n\n  True peak:\n    Peak:       -0.4 dBFS';
  const r = C.parseEbur128(s);
  near(r.integrated, -15.4); near(r.lra, 6.2); near(r.truePeak, -0.4); assert.strictEqual(r.series.length, 2);
});
t('deadlines from release date', () => {
  const d = C.deadlines('2026-11-13', '2026-10-30');
  const m = d.find(x => x.id === 'montage');
  assert.strictEqual(m.date, '2026-11-06'); assert.strictEqual(m.daysLeft, 7);
  assert.strictEqual(d.find(x => x.id === 'sortie').daysLeft, 14);
});
console.log(n + ' tests passed');
