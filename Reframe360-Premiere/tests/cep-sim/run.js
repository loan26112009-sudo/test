// Runs the CEP simulation (needs Electron: ELECTRON=/path/to/electron, and an X display or xvfb-run).
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r360sim-'));
const media = path.join(tmp, 'Osmo360 équirect.mp4'); // accents + spaces on purpose
cp.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=2048x1024:r=30:d=4', '-f', 'lavfi', '-i', 'sine=d=4',
  '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-tag:v', 'hvc1', '-c:a', 'aac', media]);
const appdata = path.join(tmp, 'appdata'); fs.mkdirSync(appdata);
const cfg = { mediaPath: media, jsx: path.join(__dirname, '..', '..', 'extension', 'host', 'premiere.jsx'), inPoint: 1, outPoint: 3, start: 10, player: 10.5 };
const env = Object.assign({}, process.env, { R360_SIM: JSON.stringify(cfg), APPDATA: appdata, R360_SHOT: path.join(process.argv[2] || tmp, 'cep-sim.png') });
const electron = process.env.ELECTRON || require('electron');
const res = cp.spawnSync(electron, ['--no-sandbox', path.join(__dirname, 'main.js')], { env, encoding: 'utf8', timeout: 240000 });
const line = (res.stdout || '').split('\n').find(l => l.startsWith('R360RESULT '));
if (!line) { console.error(res.stdout, res.stderr); process.exit(1); }
const r = JSON.parse(line.slice(11));
let fail = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
check(!r.exception, 'no exception ' + (r.exception || ''));
check(r.loaded, 'selected clip loaded from the (simulated) Premiere timeline');
check(Math.abs(r.afterLoad.time - 1.5) < 0.02 && r.afterLoad.range.in === 1 && r.afterLoad.range.out === 3, `panel starts at Premiere's playhead (media t=${r.afterLoad.time}, range ${JSON.stringify(r.afterLoad.range)})`);
check(r.afterLoad.keys > 20, `keyboard shortcuts registered with Premiere (${r.afterLoad.keys} keys)`);
check(r.hq, 'HQ preview frame decoded');
check(r.playing === true, 'Space toggles panel playback');
check(Math.abs(r.pushedPlayer - 11.5) < 0.02, `panel time pushed to Premiere playhead (${r.pushedPlayer})`);
check(r.followed, 'panel follows Premiere playhead');
check(r.rendered, 'render finished');
const f = r.final || { log: { imported: [], placed: [] } };
check(f.log.imported.length === 1, 'render imported once (double click ignored): ' + f.log.imported.join());
check(/Osmo360_équirect_R360_640x360_/.test(f.log.imported[0] || ''), 'output file name keeps accents: ' + path.basename(f.log.imported[0] || ''));
check(f.range && f.range.out === 2.5, 'render used the trimmed clip range (' + JSON.stringify(f.range) + ')');
const pl = f.log.placed[0] || {};
check(f.log.placed.length === 1 && pl.track === 2 && Math.abs(pl.start - 10) < 1e-6 && f.log.addTracks === 1, `placed on new track V3 at 10 s, B-roll on V2 untouched (${JSON.stringify(f.log.placed)})`);
check(f.disabled === true, 'original 360 clip disabled');
check(/placé/.test(f.status), 'status: ' + f.status);
if (f.log.imported[0] && fs.existsSync(f.log.imported[0])) {
  const pj = JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_frames', f.log.imported[0]]).toString());
  const v = pj.streams.find(s => s.codec_type === 'video');
  check(v.width === 640 && v.height === 360 && +v.nb_read_frames === 45 && v.codec_name === 'prores', `output ${v.codec_name} ${v.width}x${v.height}, ${v.nb_read_frames} frames (expected 45 = 1.5 s)`);
} else check(false, 'output file exists');
const sess = path.join(appdata, 'Reframe360Pro', 'sessions');
check(fs.existsSync(sess) && fs.readdirSync(sess).length === 1, 'keyframes session saved in %APPDATA%');
check(!r.errors.length, 'no console errors ' + r.errors.join(' | '));
process.exit(fail ? 1 : 0);
