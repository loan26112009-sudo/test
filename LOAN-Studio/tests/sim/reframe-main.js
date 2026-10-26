// Electron entry: loads the real panel with the CEP emulation and drives a full user session.
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 860, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: true, contextIsolation: false, sandbox: false } });
  const errors = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) errors.push(msg); });
  win.webContents.on('render-process-gone', (e, d) => { errors.push('renderer gone ' + d.reason); });
  await win.loadFile(path.join(__dirname, '..', '..', 'extension', 'reframe', 'index.html'));
  const run = (js) => win.webContents.executeJavaScript(js, true);
  const wait = async (cond, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await run(cond)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const out = { errors };
  try {
    out.loaded = await wait('!!(R360.app && R360.app.S.media)', 30000);
    out.afterLoad = await run('({ time: R360.app.S.time, range: R360.app.S.range, status: document.getElementById("status").textContent, keys: window.__keys && window.__keys.length, src: document.querySelector(".src-meta").textContent })');
    out.hq = await wait('!document.getElementById("loading").classList.contains("on")', 20000);
    // keyboard: Space must start the panel playback (and Premiere is told to leave the key alone)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await new Promise(r => setTimeout(r, 400));
    out.playing = await run('R360.app.S.playing');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await new Promise(r => setTimeout(r, 300));
    // keyframes + sync to Premiere
    await run(`(async () => { const A = R360.app;
      A.setTime(1.0); A.editCam({ yaw: 30, fov: 90, dist: 0 }); A.addKey();
      A.setTime(2.5); A.editCam({ yaw: 120, fov: 140, dist: 0.5 }); A.addKey(); })()`);
    await new Promise(r => setTimeout(r, 400));
    out.pushedPlayer = await run('window.__mock.log.setPlayer.slice(-1)[0]');
    // Premiere playhead moved by the user -> panel follows
    await run('window.__mock.movePlayer(11.0)');
    out.followed = await wait('Math.abs(R360.app.S.time - 2.0) < 0.02', 3000);
    // small custom output for speed
    await run(`(() => { const f = document.getElementById('selFormat'); f.value = 'custom'; f.dispatchEvent(new Event('change'));
      for (const [id, v] of [['outW', 640], ['outH', 360]]) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change')); } })()`);
    // the user trims the clip in Premiere after loading it: the render must follow
    await run('window.__mock.clip360.outPoint = { seconds: 2.5 }; window.__mock.clip360.end = { seconds: 11.5 };');
    await run('document.getElementById("btnRender").click(); document.getElementById("btnRender").click();');
    out.rendered = await wait('!R360.app.S.exporting', 120000);
    out.final = await run('({ status: document.getElementById("status").textContent, prog: document.getElementById("progTxt").textContent, range: R360.app.S.range, log: window.__mock.log, disabled: window.__mock.clip360.disabled, tracks: window.__mock.tracks.length })');
    await win.webContents.capturePage().then(img => require('fs').writeFileSync(process.env.R360_SHOT, img.toPNG()));
  } catch (e) { out.exception = String(e && e.stack || e); }
  process.stdout.write('R360RESULT ' + JSON.stringify(out) + '\n');
  app.exit(0);
});
