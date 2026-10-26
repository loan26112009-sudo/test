// Emulates the CEP runtime (window.__adobe_cep__, window.cep.fs) on top of Electron's mixed Node/DOM context.
const scenarios = require('./scenarios.js');
const cfg = JSON.parse(process.env.R360_SIM);
const pr = scenarios[cfg.scenario || 'reframe'](cfg);
window.__mock = pr;
window.__keys = null;
window.__openedPanels = [];
window.__adobe_cep__ = {
  evalScript(script, cb) { let r; try { r = pr.evalScript(script); } catch (e) { r = 'EvalScript error.'; console.error('jsx:', e.message, script.slice(0, 80)); } setTimeout(() => cb && cb(r), 5); },
  registerKeyEventsInterest(json) { window.__keys = JSON.parse(json); },
  requestOpenExtension(id) { window.__openedPanels.push(id); },
  getSystemPath() { return ''; }
};
window.cep = { fs: { showOpenDialogEx(multi, folder) { return { err: 0, data: [folder ? (cfg.outDir || '/tmp') : (cfg.openFile || cfg.mediaPath)] }; } } };
