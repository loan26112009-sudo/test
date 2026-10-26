// Emulates the CEP runtime (window.__adobe_cep__, window.cep.fs) on top of Electron's mixed Node/DOM context.
const path = require('path');
const { createPremiere } = require('./premiere-mock.js');
const cfg = JSON.parse(process.env.R360_SIM);
const pr = createPremiere(cfg);
window.__mock = pr;
window.__keys = null;
window.__adobe_cep__ = {
  evalScript(script, cb) { let r; try { r = pr.evalScript(script); } catch (e) { r = 'EvalScript error.'; console.error('jsx:', e.message); } setTimeout(() => cb && cb(r), 5); },
  registerKeyEventsInterest(json) { window.__keys = JSON.parse(json); },
  getSystemPath() { return ''; }
};
window.cep = { fs: { showOpenDialogEx() { return { err: 0, data: [cfg.mediaPath] }; } } };
