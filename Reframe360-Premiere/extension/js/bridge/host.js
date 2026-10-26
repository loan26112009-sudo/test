/*
 * Reframe 360 Pro — environment bridge.
 * Inside Premiere: CEP evalScript + Node.js. In a plain browser: demo mode (no Premiere, no FFmpeg).
 */
(function (root) {
  'use strict';

  var cep = root.__adobe_cep__;
  // --mixed-context exposes Node globally; separate contexts expose it as window.cep_node.
  var nodeRequire = typeof root.require === 'function' ? root.require : (root.cep_node && root.cep_node.require) || null;
  var nodeProcess = typeof root.process === 'object' && root.process.versions && root.process.versions.node ? root.process : (root.cep_node && root.cep_node.process) || null;
  var hasNode = !!(nodeRequire && nodeProcess);

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
        if (res === 'EvalScript error.') return reject(new Error('Erreur ExtendScript (script hôte non chargé ? Redémarre Premiere).'));
        try { resolve(JSON.parse(res)); } catch (e) { resolve({ ok: false, error: String(res) }); }
      });
    });
  }

  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return JSON.stringify(a); });
    return evalScript(fn + '(' + args.join(',') + ')');
  }

  function openFileDialog(title, types) {
    if (!root.cep || !root.cep.fs) return null;
    var r = root.cep.fs.showOpenDialogEx(false, false, title, '', types || ['mp4', 'mov', 'mkv', 'osv', 'lrf', 'insv', 'MP4', 'MOV', 'MKV', 'OSV', 'LRF', 'INSV']);
    return r && r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  function chooseFolder(title) {
    if (!root.cep || !root.cep.fs) return null;
    var r = root.cep.fs.showOpenDialogEx(false, true, title, '');
    return r && r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  function openFolder(dir) {
    if (!hasNode) return;
    var cp = nodeRequire('child_process');
    if (nodeProcess.platform === 'win32') cp.spawn('explorer.exe', [dir], { detached: true });
    else cp.spawn('open', [dir], { detached: true });
  }

  /*
   * Without this, Premiere also receives the keys pressed in the panel
   * (Space would start the Premiere timeline, Delete would delete clips...).
   */
  function registerKeys() {
    if (!cep || !cep.registerKeyEventsInterest) return;
    var win = (root.navigator.platform || '').indexOf('Win') >= 0;
    // Space, ←, →, K, Delete, Backspace, R, I, O, G, H, Home, End, 1..9
    var codes = win
      ? [32, 37, 39, 75, 46, 8, 82, 73, 79, 71, 72, 36, 35, 49, 50, 51, 52, 53, 54, 55, 56, 57]
      : [49, 123, 124, 40, 117, 51, 15, 34, 31, 5, 4, 115, 119, 18, 19, 20, 21, 23, 22, 26, 28, 25];
    var list = [];
    codes.forEach(function (c) { list.push({ keyCode: c }); list.push({ keyCode: c, shiftKey: true }); });
    try { cep.registerKeyEventsInterest(JSON.stringify(list)); } catch (e) {}
  }

  registerKeys();

  root.R360 = root.R360 || {};
  root.R360.host = {
    inPremiere: !!cep, hasNode: hasNode, require: nodeRequire, process: nodeProcess, extensionDir: extensionDir,
    call: call, openFileDialog: openFileDialog, chooseFolder: chooseFolder, openFolder: openFolder
  };
})(window);
