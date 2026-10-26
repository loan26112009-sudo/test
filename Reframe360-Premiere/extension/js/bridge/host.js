/*
 * Reframe 360 Pro — environment bridge.
 * Inside Premiere: CEP evalScript + Node.js. In a plain browser: demo mode (no Premiere, no FFmpeg).
 */
(function (root) {
  'use strict';

  var cep = root.__adobe_cep__;
  var hasNode = typeof root.require === 'function' && typeof root.process === 'object';

  function extensionDir() {
    var p = decodeURIComponent(root.location.pathname);
    p = p.substring(0, p.lastIndexOf('/'));
    if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1).replace(/\//g, '\\');
    return p;
  }

  function evalScript(script) {
    return new Promise(function (resolve, reject) {
      if (!cep) return reject(new Error('Premiere Pro non connecté (mode démo).'));
      cep.evalScript(script, function (res) {
        if (res === 'EvalScript error.') return reject(new Error('Erreur ExtendScript.'));
        try { resolve(JSON.parse(res)); } catch (e) { resolve({ ok: false, error: String(res) }); }
      });
    });
  }

  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return JSON.stringify(a); });
    return evalScript(fn + '(' + args.join(',') + ')');
  }

  function openFileDialog(title) {
    if (!root.cep || !root.cep.fs) return null;
    var r = root.cep.fs.showOpenDialogEx(false, false, title, '', ['mp4', 'mov', 'MP4', 'MOV', 'insv', 'osv', 'mkv']);
    return r && r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  function chooseFolder(title) {
    if (!root.cep || !root.cep.fs) return null;
    var r = root.cep.fs.showOpenDialogEx(false, true, title, '');
    return r && r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  function openFolder(dir) {
    if (!hasNode) return;
    var cp = root.require('child_process');
    if (root.process.platform === 'win32') cp.spawn('explorer.exe', [dir], { detached: true });
    else cp.spawn('open', [dir], { detached: true });
  }

  root.R360 = root.R360 || {};
  root.R360.host = {
    inPremiere: !!cep, hasNode: hasNode, extensionDir: extensionDir,
    call: call, openFileDialog: openFileDialog, chooseFolder: chooseFolder, openFolder: openFolder
  };
})(window);
