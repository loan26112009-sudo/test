// Electron entry: the real LOAN Studio panel + CEP emulation, driven through a full editing session.
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 560, height: 980, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: true, contextIsolation: false, sandbox: false } });
  const errors = [], out = { errors, steps: {} };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) errors.push(msg); });
  await win.loadFile(path.join(__dirname, '..', '..', 'extension', 'studio', 'index.html'));
  const run = (js) => win.webContents.executeJavaScript(js, true);
  const wait = async (cond, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await run(cond)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(process.env.R360_SHOTS, 'studio-' + name + '.png'), img.toPNG()); };
  const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'char', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await sleep(250); };
  const S = out.steps;
  try {
    S.ctx = await wait('!!(LS.app.ctx.seq && document.getElementById("ctxSeq").textContent.indexOf("Le sourd") >= 0)');
    S.keys = await run('window.__keys ? window.__keys.length : 0');

    // ---------------- Accueil
    await run(`document.querySelector('.rail [data-page=home]').click(); const d = document.getElementById('releaseDate'); d.value = '2026-11-13'; d.dispatchEvent(new Event('change'));`);
    await sleep(200);
    S.deadlines = await run('document.querySelectorAll("#deadlines li").length');
    S.countdown = await run('document.getElementById("countdown").textContent');
    await run('document.querySelector("#golden li").click()');
    await run(`const n = document.getElementById('resumeNote'); n.value = 'finir la coupe du passage piéton'; n.dispatchEvent(new Event('input'));`);
    await run('document.getElementById("btnBackup").click()');
    S.backup = await wait('/Dernière copie/.test(document.getElementById("backupInfo").textContent)', 8000);
    await sleep(400);
    await shot('1-accueil');

    // ---------------- Dérush
    await run('document.querySelector(".rail [data-page=derush]").click()');
    S.derushLoaded = await wait('document.getElementById("dClipName").textContent === "face-cam.mov" && document.querySelectorAll("#dList li").length >= 3');
    await run('document.getElementById("dAuto").checked = true; document.body.focus();');
    await key('1');
    S.ratedA = await wait('window.__mock.items.talk._label === 13');
    S.autoNext = await wait('document.getElementById("dClipName").textContent === "broll-paris.mov"');
    await key('4');
    S.top = await wait('window.__mock.items.broll._markers._arr.length === 1 && window.__mock.items.broll._markers._arr[0].name.indexOf("⭐") === 0');
    await key('2');
    S.ratedB = await wait('window.__mock.items.broll._label === 15');
    await sleep(300);
    S.progress = await run('document.getElementById("dProgress").textContent');
    await shot('2-derush');
    await run('document.getElementById("dMakeSelects").click()');
    S.selects = await wait('(() => { const b = window.__mock.findBin("SÉLECTS"), t = window.__mock.findBin("⭐ TOP"); return b && t && b._kids.length === 1 && t._kids.length === 1; })()', 8000);

    // ---------------- Structure
    await run('document.querySelector(".rail [data-page=structure]").click(); document.getElementById("sImport").click();');
    await run(`document.getElementById('modalText').value = ['LOOP BUILDER — NOTES', 'Durée : 0:16', '── BOUCLES PRINCIPALES ──', '  [0:00→0:06] Va-t-il tenir ?', '── SOUS-BOUCLES ──', '  [0:02→0:05] Elliot ne le croit pas (étage 1)', '── MARQUEURS ──', '  Twist à 0:09'].join('\\n'); document.getElementById('modalOk').click();`);
    await sleep(300);
    await run('document.getElementById("sImport").click()');
    await run(`document.getElementById('modalText').value = 'Intro | 0:04 | Curiosité\\nPhase 1 | 0:06 | Tension\\nPhase 2 | 0:06 | Tension'; document.getElementById('modalOk').click();`);
    await sleep(300);
    S.structure = await run('({ segs: LS.app.project.segments.length, loops: LS.app.project.loops.length, target: LS.app.project.target, issues: [...document.querySelectorAll("#sIssues li")].map(l => l.textContent) })');
    await run('document.getElementById("sPush").click()');
    S.pushed = await wait('window.__mock.items.seq.markers._arr.length === 6');
    await run('window.__mock.items.seq.markers._arr.find(m => m.name === "[SEG] Phase 1").start = { seconds: 5 }; 0');
    await run('document.getElementById("sPull").click()');
    S.pulled = await wait('LS.app.project.segments[1].start === 5');
    S.chapters = await run('document.getElementById("chText").value');
    await run(`document.getElementById('phName').value = 'MANETTE'; document.getElementById('phDur').value = 2; document.getElementById('phMake').click();`);
    S.placeholder = await wait('window.__mock.log.placed.some(p => /PLACEHOLDER_MANETTE/.test(p.path) && p.track === 1 && p.start === 3)', 30000);
    S.musicIntact = await run('window.__mock.items.seq._a[1]._clips.length === 1 && window.__mock.items.seq._a[1]._clips[0].name === "musique.wav"');
    await sleep(300);
    await shot('3-structure');

    // ---------------- Blancs
    await run('document.querySelector(".rail [data-page=blancs]").click(); document.getElementById("bPick").click();');
    await wait('/face-cam/.test(document.getElementById("bClip").textContent)');
    await run('document.getElementById("bAnalyze").click()');
    S.blancs = await wait('!document.getElementById("bApply").disabled', 20000);
    S.blancsText = await run('document.getElementById("bResult").textContent');
    await shot('4-blancs');
    await run('document.getElementById("bApply").click()');
    S.jumpcut = await wait('window.__mock.app.project.activeSequence.name === "face-cam — sans blancs" && window.__mock.app.project.activeSequence._v[0]._clips.length === 2');
    await run('window.__mock.app.project.activeSequence = window.__mock.items.seq; 0');

    // ---------------- Audio
    await run('document.querySelector(".rail [data-page=audio]").click()');
    await wait('document.querySelectorAll("#aTracks tbody tr").length === 3');
    await run('document.getElementById("aAnalyze").click()');
    S.audioAnalyzed = await wait('!document.getElementById("aApply").disabled', 20000);
    await run('document.getElementById("aApply").click()');
    S.audioApplied = await wait('window.__mock.log.levels.length === 3');
    S.levels = await run(`(() => { const s = window.__mock.items.seq, db = v => 20 * Math.log10(v) + 15; return [0, 1, 2].map(i => +db(window.__mock.levelProp(s._a[i]._clips[0]).getValue()).toFixed(1)); })()`);
    await run('document.getElementById("lPick").click()');
    S.loud = await wait('/LUFS/.test(document.getElementById("lResult").textContent)', 20000);
    await sleep(300);
    await shot('5-audio');

    // ---------------- Short
    await run('window.__mock.items.seq._in = 1; window.__mock.items.seq._out = 4; 0');
    await run('LS.app.refreshContext().then(() => document.querySelector(".rail [data-page=short]").click())');
    await sleep(300);
    S.shortRange = await run('document.getElementById("shRange").textContent');
    await run('document.getElementById("shMake").click()');
    S.short = await wait('window.__mock.app.project.activeSequence.frameSizeVertical === 1920', 8000);
    await shot('6-short');
    await run('window.__mock.app.project.activeSequence = window.__mock.items.seq; LS.app.refreshContext(); 0');

    // ---------------- Proxies
    await run('window.__mock.select([window.__mock.items.day1]); document.querySelector(".rail [data-page=proxies]").click(); document.getElementById("pStart").click();');
    S.proxies = await wait('/attaché/.test(document.getElementById("pResult").textContent)', 60000);
    S.attached = await run('window.__mock.log.attached.map(a => a.name)');
    await shot('7-proxies');

    // ---------------- Vérif
    await run('document.querySelector(".rail [data-page=verif]").click(); document.getElementById("vRun").click();');
    await wait('document.getElementById("vSummary").textContent.length > 0');
    S.audit = await run('[...document.querySelectorAll("#vList li")].map(l => l.querySelector(".s").textContent + " " + l.querySelector(".x").firstChild.textContent)');
    await run(`const t = document.getElementById('fbText'); t.value = '0:05 trop long\\nà 0min12 le son sature'; t.dispatchEvent(new Event('input')); document.getElementById('fbPush').click();`);
    S.feedback = await wait('document.querySelectorAll("#fbList li").length === 2');
    await run('document.querySelector("#fbList .act").click()');
    S.feedbackDone = await wait('window.__mock.items.seq.markers._arr.some(m => m.name === "[OK] trop long")');
    await run('document.getElementById("eBtn").click()');
    S.exportCheck = await wait('document.querySelectorAll("#eList li").length >= 6', 20000);
    S.exportItems = await run('[...document.querySelectorAll("#eList li")].map(l => l.textContent)');
    await sleep(300);
    await shot('8-verif');

    // ---------------- 360 + settings
    await run('document.querySelector(".rail [data-page=r360]").click(); document.getElementById("rOpen").click();');
    S.r360 = await run('window.__openedPanels.indexOf("com.loanstudio.reframe360") >= 0');
    await run('document.getElementById("btnSettings").click()');
    S.diag = await wait('/ffmpeg version/.test(document.getElementById("diag").textContent)', 10000);
    await shot('9-reglages');
    S.projectFile = await run('(() => { const f = require("fs"), p = require("path"), d = p.join(process.env.APPDATA, "LoanStudio", "projects"); return f.existsSync(d) ? f.readdirSync(d).length : 0; })()');
  } catch (e) { out.exception = String(e && e.stack || e); }
  process.stdout.write('LSRESULT ' + JSON.stringify(out) + '\n');
  app.exit(0);
});
