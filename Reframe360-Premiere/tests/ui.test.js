// Loads the panel in demo mode (no Premiere), checks for JS errors, exercises lenses/keyframes and saves screenshots.
// Run: node tests/ui.test.js <outDir>
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'extension', 'index.html'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '00-panel.png') });
  for (const [i, id] of ['tele', 'normal', 'wide', 'uwide', 'hwide', 'fisheye', 'planet', 'rabbit', 'ball'].entries()) {
    await page.keyboard.press(String(i + 1));
    await page.waitForTimeout(450);
    await page.locator('#viewer').screenshot({ path: path.join(out, `lens-${i + 1}-${id}.png`) });
  }
  // keyframe animation: 3 keys, check interpolation drives the camera
  const r = await page.evaluate(async () => {
    const A = R360.app, S = A.S;
    A.setTime(0); A.editCam({ yaw: 0, pitch: 0, fov: 90, dist: 0 }); A.addKey();
    A.setTime(3); A.editCam({ yaw: 120, pitch: 10, fov: 140, dist: 0.6 }); A.addKey();
    A.setTime(6); A.editCam({ yaw: -150, pitch: -20, fov: 75, dist: 0 }); A.addKey();
    A.setTime(1.5); const mid = Object.assign({}, S.cam);
    A.setTime(4.5); const mid2 = Object.assign({}, S.cam);
    return { keys: S.track.keys.length, mid, mid2 };
  });
  console.log('keys', r.keys, 'cam@1.5s', JSON.stringify(r.mid), 'cam@4.5s', JSON.stringify(r.mid2));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '01-keyframes.png') });
  await page.click('.tabs button[data-tab=export]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '02-export.png') });
  await page.selectOption('#selFormat', 'v4k');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '03-vertical.png') });
  await page.click('.tabs button[data-tab=settings]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '04-settings.png') });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no JS errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
