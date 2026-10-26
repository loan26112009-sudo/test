// Real-FFmpeg tests of LOAN Studio's media tools. Run: node tests/studio-media.test.js [outDir]
const ff = require('../extension/shared/js/ffmpeg.js');
const C = require('../extension/studio/js/core/core.js');
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-media-'));
const shotDir = process.argv[2] || tmp;
const tools = ff.locate(null, null);
let fail = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const sh = (args) => cp.execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args));

(async () => {
  // "speech" = tone bursts: 0-2 s, 3-5 s, 5.3-7 s ; silence elsewhere (10 s total), 4-channel audio + video
  const talk = path.join(tmp, 'talk.mov');
  sh(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=10', '-f', 'lavfi', '-i',
    "aevalsrc='0.5*sin(2*PI*220*t)*(lt(t,2)+between(t,3,5)+between(t,5.3,7))':s=48000:d=10",
    '-filter_complex', '[1:a]pan=4c|c0=c0|c1=c0|c2=c0|c3=c0[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', talk]);
  const info = await ff.probe(tools, talk);

  const log = await ff.silences(tools, talk, 0, 10, -35, 0.4);
  const keep = C.speechSegments(C.parseSilences(log), 10, 0.1, 0.25);
  check(keep.length === 2 && Math.abs(keep[0].end - 2.1) < 0.06 && Math.abs(keep[1].start - 2.9) < 0.06 && Math.abs(keep[1].end - 7.1) < 0.06,
    'jump-cut: speech kept ' + keep.map(k => k.start.toFixed(2) + '→' + k.end.toFixed(2)).join(', ') + ' (short 0.3 s pause kept, long blanks removed)');
  const sub = await ff.silences(tools, talk, 4, 4, -35, 0.4);
  const keepSub = C.speechSegments(C.parseSilences(sub), 4, 0.1, 0.25);
  check(keepSub.length === 1 && keepSub[0].start === 0 && Math.abs(keepSub[0].end - 3.1) < 0.06, 'jump-cut on a sub-range (clip in/out) uses clip-relative times');

  const pk = await ff.peaks(tools, talk, 0, 10);
  check(Math.abs(pk.peak - (-6.0)) < 0.3, 'peak level of 0.5 sine = ' + pk.peak + ' dBFS');

  const L = C.parseEbur128(await ff.loudness(tools, talk));
  check(isFinite(L.integrated) && L.integrated < 0 && L.integrated > -30 && L.series.length > 50 && L.truePeak < -5, `loudness: I ${L.integrated} LUFS, TP ${L.truePeak} dBFS, ${L.series.length} points`);

  const ph = path.join(tmp, 'ph.mp4');
  await ff.makePlaceholder(tools, { out: ph, name: 'MANETTE — passage piéton', seconds: 3.5, width: 1920, height: 1080, fps: '30000/1001' });
  const pi = await ff.probe(tools, ph);
  check(pi.width === 1920 && pi.height === 1080 && Math.abs(pi.duration - 3.5) < 0.1 && !pi.hasAudio && Math.abs(pi.fps - 29.97) < 0.01, `placeholder ${pi.width}x${pi.height} ${pi.fps.toFixed(2)} fps ${pi.duration.toFixed(2)} s, video only (never touches the music track)`);
  sh(['-ss', '1', '-i', ph, '-frames:v', '1', path.join(shotDir, 'placeholder.png')]);

  for (const codec of ['cineform', 'prores']) {
    const out = path.join(tmp, 'proxy_' + codec + '.mov');
    let last = 0;
    const job = ff.makeProxy(tools, info, { out, codec, width: 1280, onProgress: p => last = p });
    await job.done;
    const j = JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out]).toString());
    const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
    check(v.codec_name === (codec === 'cineform' ? 'cfhd' : 'prores') && a.channels === 4 && Math.abs(+j.format.duration - 10) < 0.1 && v.width / v.height === 16 / 9,
      `${codec} proxy ${v.codec_name} ${v.width}x${v.height}, ${a.channels} ch audio, ${(+j.format.duration).toFixed(2)} s, progress ${last.toFixed(2)}`);
  }
  // 360 2:1 source keeps its ratio
  const eq = path.join(tmp, 'eq.mp4');
  sh(['-f', 'lavfi', '-i', 'testsrc2=s=3840x1920:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', eq]);
  const j2 = ff.makeProxy(tools, await ff.probe(tools, eq), { out: path.join(tmp, 'eqp.mov'), codec: 'cineform', width: 1920 });
  await j2.done;
  check(j2.size[0] === 1920 && j2.size[1] === 960, '360 proxy keeps 2:1 (' + j2.size.join('x') + ')');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
