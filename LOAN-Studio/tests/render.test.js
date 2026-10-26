// Compares the WebGL2 export shader against the numpy reference (tests/render_ref.py).
// Run: node tests/render.test.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const EXT = path.join(__dirname, '..', 'extension', 'reframe', 'js');
const W = 512, H = 256;
const CASES = [
  { name: 'normal-front', yaw: 0, pitch: 0, roll: 0, fov: 75, dist: 0, outW: 160, outH: 90, ss: 1, filter: 'bicubic' },
  { name: 'wrap-seam', yaw: 178, pitch: 12, roll: 8, fov: 90, dist: 0, outW: 160, outH: 90, ss: 1, filter: 'lanczos' },
  { name: 'ultrawide-ss', yaw: -40, pitch: -20, roll: 0, fov: 125, dist: 0.4, outW: 120, outH: 160, ss: 2, filter: 'lanczos' },
  { name: 'tiny-planet', yaw: 30, pitch: -90, roll: 0, fov: 290, dist: 1, outW: 128, outH: 128, ss: 3, filter: 'bicubic' },
  { name: 'crystal-ball', yaw: 0, pitch: 0, roll: 0, fov: 338, dist: 1.5, outW: 128, outH: 72, ss: 1, filter: 'bicubic' },
];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r360-'));
  const src = path.join(tmp, 'src.raw');
  cp.execFileSync('python3', ['-I', path.join(__dirname, 'render_ref.py'), 'gen', src, W, H]);
  const srcB64 = fs.readFileSync(src).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'core/math.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'gl/renderer.js'), 'utf8') });

  let failed = 0;
  for (const c of CASES) {
    const gpuB64 = await page.evaluate(({ srcB64, W, H, c }) => {
      const M = R360.math;
      const bin = atob(srcB64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const r = window.__r || (window.__r = new R360.Reframer(document.createElement('canvas')));
      r.setExportSource(u8, W, H);
      const out = new Uint8Array(c.outW * c.outH * 4);
      r.renderExport({ outW: c.outW, outH: c.outH, filter: c.filter, ss: c.ss, dist: c.dist,
        samples: [{ matrix: M.cameraMatrix(c, null), scale: M.lensScale(c.fov, c.dist) }] }, out);
      let s = ''; for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
      return btoa(s);
    }, { srcB64, W, H, c });
    const gpu = new Uint32Array(Buffer.from(gpuB64, 'base64').buffer.slice(0));
    const pj = path.join(tmp, c.name + '.json'), ro = path.join(tmp, c.name + '.ref');
    fs.writeFileSync(pj, JSON.stringify(c));
    cp.execFileSync('python3', ['-I', path.join(__dirname, 'render_ref.py'), 'ref', src, W, H, pj, ro]);
    const ref = new Uint32Array(fs.readFileSync(ro).buffer.slice(0));
    let se = 0, maxe = 0, n = 0;
    for (let i = 0; i < ref.length; i++) {
      for (const sh of [20, 10, 0]) {
        const e = ((gpu[i] >>> sh) & 1023) - ((ref[i] >>> sh) & 1023);
        se += e * e; maxe = Math.max(maxe, Math.abs(e)); n++;
      }
      if (gpu[i] >>> 30) { maxe = 9999; }
    }
    const psnr = 10 * Math.log10(1023 * 1023 / Math.max(se / n, 1e-9));
    const ok = psnr > 50;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name.padEnd(14)} PSNR ${psnr.toFixed(1)} dB  max|err| ${maxe} (10-bit codes)`);
  }
  // Motion blur: N identical sub-samples must give exactly the single-sample image,
  // and a real camera move must blur (differ) without breaking the image.
  const mb = await page.evaluate(() => {
    const M = R360.math, r = window.__r, cam = { yaw: 20, pitch: 5, roll: 0, fov: 90, dist: 0 };
    const one = { matrix: M.cameraMatrix(cam, null), scale: M.lensScale(90, 0) };
    const a = new Uint8Array(160 * 90 * 4), b = new Uint8Array(a.length), c = new Uint8Array(a.length);
    r.renderExport({ outW: 160, outH: 90, filter: 'bicubic', ss: 1, dist: 0, samples: [one] }, a);
    r.renderExport({ outW: 160, outH: 90, filter: 'bicubic', ss: 1, dist: 0, samples: Array(10).fill(one) }, b);
    const moving = Array.from({ length: 10 }, (_, k) => ({ matrix: M.cameraMatrix({ ...cam, yaw: 20 + k }, null), scale: one.scale }));
    r.renderExport({ outW: 160, outH: 90, filter: 'bicubic', ss: 2, dist: 0, samples: moving }, c);
    const wa = new Uint32Array(a.buffer), wb = new Uint32Array(b.buffer), wc = new Uint32Array(c.buffer);
    let maxe = 0, diff = 0;
    for (let i = 0; i < wa.length; i++) {
      for (const sh of [20, 10, 0]) maxe = Math.max(maxe, Math.abs(((wa[i] >>> sh) & 1023) - ((wb[i] >>> sh) & 1023)));
      if (wa[i] !== wc[i]) diff++;
    }
    return { identical: maxe <= 1, blurredDiffers: diff > wa.length * 0.2 };
  });
  const mbOk = mb.identical && mb.blurredDiffers;
  if (!mbOk) failed++;
  console.log(`${mbOk ? 'PASS' : 'FAIL'} motion-blur    identical-samples=${mb.identical} moving-camera-blurs=${mb.blurredDiffers}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
