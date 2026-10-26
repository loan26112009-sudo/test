// End-to-end: real FFmpeg decode (10-bit) -> real WebGL2 exporter loop -> real FFmpeg ProRes encode.
// Checks frame count, timing alignment, colour tags, audio, and image fidelity vs the numpy reference.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ff = require('../extension/shared/js/ffmpeg.js');

const EXT = path.join(__dirname, '..', 'extension', 'reframe', 'js');
const tools = ff.locate(null, null);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r360p-'));
const src = path.join(tmp, 'src.mov');
const W = 1024, H = 512, FPS = 25;

function sh(bin, args) { return cp.execFileSync(bin, args, { maxBuffer: 1 << 30 }); }
function psnr10(a, b) {
  let se = 0, n = 0;
  for (let i = 0; i < a.length; i++) for (const s of [20, 10, 0]) { const e = ((a[i] >>> s) & 1023) - ((b[i] >>> s) & 1023); se += e * e; n++; }
  return 10 * Math.log10(1023 * 1023 / Math.max(se / n, 1e-9));
}
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; }

(async () => {
  // 10-bit 4:2:2 ProRes "360" source with a moving pattern + a frame counter, and stereo audio.
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${FPS}:d=2`,
    '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000',
    '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'pcm_s16le', src]);

  const info = await ff.probe(tools, src);
  check(info.isEquirect && info.width === W && Math.abs(info.fps - FPS) < 1e-6 && info.hasAudio, `probe ${info.width}x${info.height} ${info.fps}fps audio=${info.hasAudio}`);

  const t0 = 0.4, count = 20; // frames 10..29
  const outW = 480, outH = 270;
  const out = path.join(tmp, 'out.mov');
  const cam = { yaw: 35, pitch: -10, roll: 4, fov: 110, dist: 0.3 };

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e));
  await page.setContent('<body></body>');
  for (const f of ['core/math.js', 'core/keyframes.js', 'gl/renderer.js', 'app/exporter.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, f), 'utf8') });

  const dec = ff.openDecoder(tools, info, t0, count, false);
  const enc = ff.openEncoder(tools, { out, width: outW, height: outH, rate: info.rate, codec: 'prores_hq', color: info.color,
    audio: { path: src, t0, duration: count / FPS }, sharpen: 0 });
  await page.exposeFunction('decRead', async () => { const b = await dec.read(); return b ? b.toString('base64') : null; });
  await page.exposeFunction('encWrite', async (b64) => { await enc.write(new Uint8Array(Buffer.from(b64, 'base64'))); });
  await page.exposeFunction('encFinish', () => enc.finish());

  const res = await page.evaluate(async ({ W, H, outW, outH, FPS, t0, count, cam }) => {
    const b64ToU8 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
    const u8ToB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
    const r = new R360.Reframer(document.createElement('canvas'));
    return R360.exporter.renderJob({
      renderer: r,
      decoder: { read: async () => { const s = await decRead(); return s ? b64ToU8(s) : null; }, kill() {} },
      encoder: { write: (u) => encWrite(u8ToB64(u)), finish: () => encFinish(), kill() {} },
      srcW: W, srcH: H, outW, outH, fps: FPS, t0, count,
      camAt: () => cam, corr: null, filter: 'lanczos', ss: 'auto', motionBlur: { enabled: false }
    });
  }, { W, H, outW, outH, FPS, t0, count, cam });
  await browser.close();
  check(res.frames === count, `exporter rendered ${res.frames}/${count} frames`);

  const pj = JSON.parse(sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_frames', out]).toString());
  const vs = pj.streams.find(s => s.codec_type === 'video'), as = pj.streams.find(s => s.codec_type === 'audio');
  check(+vs.nb_read_frames === count, `output frames ${vs.nb_read_frames}`);
  check(vs.codec_name === 'prores' && vs.pix_fmt === 'yuv422p10le' && vs.profile === 'HQ', `codec ${vs.codec_name} ${vs.profile} ${vs.pix_fmt}`);
  check(vs.color_space === 'bt709' && vs.color_transfer === 'bt709' && vs.color_primaries === 'bt709', `colour tags ${vs.color_space}/${vs.color_transfer}/${vs.color_primaries}`);
  check(as && as.codec_name === 'pcm_s24le' && Math.abs(+as.duration - count / FPS) < 0.03, `audio ${as && as.codec_name} ${as && as.duration}s`);

  // Fidelity: frame k of the output vs. reference reprojection of source frame (10 + k).
  for (const k of [0, 7, 19]) {
    const srcRaw = path.join(tmp, `s${k}.raw`), refRaw = path.join(tmp, `r${k}.raw`), pj2 = path.join(tmp, 'p.json');
    sh('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `select=eq(n\\,${10 + k}),scale=in_color_matrix=bt709:in_range=tv:flags=spline+accurate_rnd+full_chroma_int+full_chroma_inp`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', srcRaw]);
    fs.writeFileSync(pj2, JSON.stringify({ ...cam, outW, outH, ss: 1, filter: 'lanczos' }));
    sh('python3', ['-I', path.join(__dirname, 'render_ref.py'), 'ref', srcRaw, W, H, pj2, refRaw]);
    const got = sh('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select=eq(n\\,${k}),scale=in_color_matrix=bt709:in_range=tv:flags=spline+accurate_rnd+full_chroma_int+full_chroma_inp`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', 'pipe:1']);
    const p = psnr10(new Uint32Array(got.buffer.slice(got.byteOffset, got.byteOffset + got.length)), new Uint32Array(fs.readFileSync(refRaw).buffer.slice(0)));
    // and against the wrong neighbour frame, to prove timing alignment
    const p2src = path.join(tmp, `n${k}.raw`), p2ref = path.join(tmp, `nr${k}.raw`);
    sh('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `select=eq(n\\,${11 + k}),scale=in_color_matrix=bt709:in_range=tv:flags=spline+accurate_rnd+full_chroma_int+full_chroma_inp`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', p2src]);
    sh('python3', ['-I', path.join(__dirname, 'render_ref.py'), 'ref', p2src, W, H, pj2, p2ref]);
    const pn = psnr10(new Uint32Array(got.buffer.slice(got.byteOffset, got.byteOffset + got.length)), new Uint32Array(fs.readFileSync(p2ref).buffer.slice(0)));
    // Codec ceiling: the reference itself pushed through the same encoder chain and decoded back.
    const ceilOut = path.join(tmp, `c${k}.mov`);
    const e2 = ff.openEncoder(tools, { out: ceilOut, width: outW, height: outH, rate: info.rate, codec: 'prores_hq', color: info.color, audio: null, sharpen: 0 });
    await e2.write(new Uint8Array(fs.readFileSync(refRaw))); await e2.finish();
    const cg = sh('ffmpeg', ['-v', 'error', '-i', ceilOut, '-vf', 'scale=in_color_matrix=bt709:in_range=tv:flags=spline+accurate_rnd+full_chroma_int+full_chroma_inp', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', 'pipe:1']);
    const ceil = psnr10(new Uint32Array(cg.buffer.slice(cg.byteOffset, cg.byteOffset + cg.length)), new Uint32Array(fs.readFileSync(refRaw).buffer.slice(0)));
    check(p > ceil - 0.5 && p > pn + 3, `frame ${k}: PSNR vs reference ${p.toFixed(1)} dB (codec ceiling ${ceil.toFixed(1)} dB, next source frame ${pn.toFixed(1)} dB)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
