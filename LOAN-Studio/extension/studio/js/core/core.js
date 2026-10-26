/*
 * LOAN Studio — pure logic (no Premiere, no DOM): shared by the panel and the unit tests.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ time

  // "1:23", "01:23", "1:02:03", "1:02:03:12" (frames, needs fps), "83", "83s", "1m23", "1min23s", "1h02m03s"
  function parseTime(str, fps) {
    if (str === null || str === undefined) return NaN;
    var s = String(str).trim().toLowerCase().replace(',', '.');
    if (!s) return NaN;
    var m = s.match(/^(\d+(?:\.\d+)?)\s*s?$/);
    if (m) return +m[1];
    m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*(?:s(?:ec)?)?)?$/);
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    var parts = s.split(/[:;]/);
    if (parts.length < 2 || parts.length > 4 || parts.some(function (p) { return !/^\d+(\.\d+)?$/.test(p); })) return NaN;
    var n = parts.map(Number);
    if (n.length === 2) return n[0] * 60 + n[1];
    if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
    return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / (fps || 30);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // YouTube style: m:ss or h:mm:ss
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  function fmtTC(sec, fps) {
    fps = fps || 30;
    var fi = Math.max(1, Math.round(fps)), fr = Math.max(0, Math.round(sec * fps));
    var f = fr % fi, s = Math.floor(fr / fi);
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60) + ':' + pad2(f);
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' s';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + ' min' + (s ? ' ' + pad2(s) : '');
    return Math.floor(m / 60) + ' h ' + pad2(m % 60);
  }

  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // ------------------------------------------------------------------ imports

  /*
   * Text exported by Loop Builder ("Exporter les notes"):
   *   Durée : 15:00
   *   ── BOUCLES PRINCIPALES ──
   *     [0:00→12:30] Va-t-il tenir 100h ?
   *   ── SOUS-BOUCLES ──
   *     [0:40→2:10] Elliot ne le croit pas (étage 1)
   *   ── MARQUEURS ──
   *     Twist à 6:12
   */
  function parseLoopBuilder(text) {
    var out = { title: '', duration: NaN, loops: [], markers: [] };
    var section = '';
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m;
      if ((m = line.match(/^Vid[ée]o\s*:\s*(.+)$/i))) { out.title = m[1].trim(); return; }
      if ((m = line.match(/^Dur[ée]e\s*:\s*(.+)$/i))) { out.duration = parseTime(m[1]); return; }
      if (/BOUCLES PRINCIPALES/i.test(line)) { section = 'macro'; return; }
      if (/SOUS-BOUCLES/i.test(line)) { section = 'micro'; return; }
      if (/MARQUEURS/i.test(line)) { section = 'markers'; return; }
      if (/^[─═]/.test(line)) { section = 'other'; return; }
      if (section === 'macro' || section === 'micro') {
        m = line.match(/^\[\s*([\d:.]+)\s*(?:→|->|-)\s*([\d:.]+)\s*\]\s*(.+?)(?:\s*\(étage\s*(\d+)\))?$/i);
        if (m) out.loops.push({ label: m[3].trim(), start: parseTime(m[1]), end: parseTime(m[2]), level: section, row: +m[4] || 0 });
      } else if (section === 'markers') {
        m = line.match(/^(.+?)\s+à\s+([\d:.]+)$/i);
        if (m) out.markers.push({ label: m[1].trim(), t: parseTime(m[2]) });
      }
    });
    return out;
  }

  /*
   * One segment per line, separators | ; tab or " - ":
   *   Intro | 0:45 | Curiosité
   *   Phase 1 — Jeux 2:30
   * Lines without a duration get 0.
   */
  function parseSegments(text) {
    var segs = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^\s*[-*•\d.)]+\s+/, '').trim();
      if (!line || /^#/.test(line)) return;
      var parts = line.split(/\s*[|;\t]\s*/), name = parts[0], dur = NaN, emotion = '';
      if (parts.length > 1) { dur = parseTime(parts[1]); emotion = (parts[2] || '').trim(); }
      if (isNaN(dur)) {
        var m = name.match(/^(.*?)[\s(]+((?:\d+h)?\d+(?::\d{2}){1,2}|\d+\s*(?:s|min|m)(?:\s*\d+\s*s?)?)\)?$/i);
        if (m) { name = m[1].replace(/[\s—–-]+$/, ''); dur = parseTime(m[2]); }
      }
      segs.push({ name: name.trim(), duration: isNaN(dur) ? 0 : dur, emotion: emotion });
    });
    return segs;
  }

  /*
   * Feedback notes with timestamps (YouTube-comment style):
   *   "2:31 trop long" · "à 4min10 le son sature" · "12:05-12:40 coupe ça" · "[1:02:03] super"
   */
  function parseFeedback(text) {
    var out = [];
    var re = /\[?\b((?:\d{1,2}:)?\d{1,2}:\d{2}|\d+\s*min\s*\d{0,2}\s*s?|\d+\s*m\s*\d{1,2}\s*s?)\b\]?(?:\s*(?:-|→|à|a)\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/i;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(re);
      if (!m) return;
      var t = parseTime(m[1].replace(/\s+/g, ''));
      if (isNaN(t)) return;
      var end = m[2] ? parseTime(m[2]) : NaN;
      var note = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ')
        .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').replace(/^(?:à|a|vers)\s+/i, '');
      out.push({ t: t, end: end > t ? end : null, text: note || '(sans texte)' });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  // ------------------------------------------------------------------ structure analysis

  // Cumulative start times from target durations.
  function layoutSegments(segs) {
    var t = 0;
    return segs.map(function (s) { var r = Object.assign({}, s, { start: t, end: t + (s.duration || 0) }); t = r.end; return r; });
  }

  /*
   * Retention map: how many loops are open at each moment.
   * Rule from Loan's process: always 1 to 3 loops open; never all closed at once.
   */
  function retention(loops, duration, opts) {
    opts = opts || {};
    var step = opts.step || 1, minGap = opts.minGap === undefined ? 8 : opts.minGap, maxOpen = opts.maxOpen || 3;
    var samples = [], issues = [];
    for (var t = 0; t <= duration + 1e-9; t += step) {
      var n = 0;
      for (var i = 0; i < loops.length; i++) if (loops[i].start <= t && t < loops[i].end) n++;
      samples.push({ t: t, open: n });
    }
    // contiguous stretches where pred(open count) holds
    function runs(pred) {
      var res = [], start = null;
      for (var i = 0; i < samples.length; i++) {
        var p = samples[i];
        if (pred(p.open)) { if (start === null) start = p.t; }
        else if (start !== null) { res.push({ start: start, end: p.t }); start = null; }
      }
      if (start !== null) res.push({ start: start, end: duration });
      return res;
    }
    runs(function (n) { return n === 0; }).forEach(function (r) {
      if (r.end - r.start >= minGap) issues.push({ type: 'none', start: r.start, end: r.end, text: 'Aucune boucle ouverte pendant ' + fmtDuration(r.end - r.start) + ' — le spectateur n\'a plus de raison de rester' });
    });
    runs(function (n) { return n > maxOpen; }).forEach(function (r) {
      if (r.end - r.start >= 2) issues.push({ type: 'many', start: r.start, end: r.end, text: 'Plus de ' + maxOpen + ' boucles ouvertes en même temps (' + fmtDuration(r.end - r.start) + ') : risque de perdre le spectateur' });
    });
    return { samples: samples, issues: issues.sort(function (a, b) { return a.start - b.start; }) };
  }

  // Two consecutive segments with the same target emotion (Loan's rule: always a contrast).
  function emotionIssues(segs) {
    var out = [];
    for (var i = 1; i < segs.length; i++) {
      var a = (segs[i - 1].emotion || '').trim().toLowerCase(), b = (segs[i].emotion || '').trim().toLowerCase();
      if (a && a === b) out.push({ index: i, text: '« ' + segs[i - 1].name + ' » et « ' + segs[i].name + ' » ont la même émotion (' + segs[i].emotion + ') : ajoute un contraste' });
    }
    return out;
  }

  // YouTube chapters: first at 0:00, at least 3 chapters, each at least 10 s.
  function chapters(items) {
    var list = items.filter(function (c) { return c.name; }).slice().sort(function (a, b) { return a.start - b.start; });
    var warnings = [];
    if (list.length && list[0].start > 0.5) { list.unshift({ name: 'Intro', start: 0 }); warnings.push('Ajout d\'un chapitre « Intro » à 0:00 (obligatoire pour YouTube).'); }
    if (list.length) list[0].start = 0;
    if (list.length < 3) warnings.push('YouTube exige au moins 3 chapitres.');
    for (var i = 0; i < list.length - 1; i++) {
      if (list[i + 1].start - list[i].start < 10) warnings.push('« ' + list[i].name + ' » dure moins de 10 s : YouTube ignorera les chapitres.');
    }
    return { text: list.map(function (c) { return fmtTime(c.start) + ' ' + c.name; }).join('\n'), warnings: warnings };
  }

  // ------------------------------------------------------------------ audio

  // FFmpeg silencedetect output -> [{start, end}] (end = Infinity if the clip ends in silence)
  function parseSilences(stderr) {
    var out = [], cur = null;
    String(stderr || '').split(/\r?\n/).forEach(function (l) {
      var m = l.match(/silence_start:\s*(-?[\d.]+)/);
      if (m) { cur = { start: Math.max(0, +m[1]), end: Infinity }; out.push(cur); return; }
      m = l.match(/silence_end:\s*([\d.]+)/);
      if (m && cur) { cur.end = +m[1]; cur = null; }
    });
    return out;
  }

  /*
   * Parts to KEEP between silences, relative to the analysed range [0, duration].
   * pad: breathing room kept around speech; minKeep: drop blips shorter than this.
   */
  function speechSegments(silences, duration, pad, minKeep) {
    pad = pad === undefined ? 0.12 : pad; minKeep = minKeep === undefined ? 0.25 : minKeep;
    var keep = [], t = 0;
    silences.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (s) {
      var a = t, b = Math.min(duration, s.start + pad);
      if (b - a > 0) keep.push({ start: a, end: b });
      t = Math.max(t, Math.min(duration, s.end) - pad);
    });
    if (duration - t > 0) keep.push({ start: t, end: duration });
    // merge overlaps created by padding, drop tiny blips
    var merged = [];
    keep.forEach(function (k) {
      k = { start: Math.max(0, k.start), end: Math.min(duration, k.end) };
      var last = merged[merged.length - 1];
      if (last && k.start <= last.end + 0.02) last.end = Math.max(last.end, k.end);
      else merged.push(k);
    });
    return merged.filter(function (k) { return k.end - k.start >= minKeep; });
  }

  function dbToLevel(db) { return Math.pow(10, (db - 15) / 20); } // Premiere "Level" property value
  function levelToDb(v) { return v > 0 ? 20 * Math.log(v) / Math.LN10 + 15 : -Infinity; }

  // Gain (dB) to bring a measured peak to the target, limited to Premiere's +15 dB clip gain.
  function gainFor(peakDb, targetDb, maxBoost) {
    maxBoost = maxBoost === undefined ? 15 : maxBoost;
    if (!isFinite(peakDb) || peakDb < -80) return { gain: 0, clipped: false, silent: true }; // digital silence
    var g = targetDb - peakDb;
    var clipped = g > maxBoost;
    return { gain: Math.round(Math.min(g, maxBoost) * 10) / 10, clipped: clipped, silent: false };
  }

  // FFmpeg ebur128 summary + short-term series
  function parseEbur128(stderr) {
    var s = String(stderr || ''), res = { integrated: NaN, lra: NaN, truePeak: NaN, series: [] };
    var re = /t:\s*([\d.]+)\s+.*?S:\s*(-?[\d.]+|-inf)/g, m;
    while ((m = re.exec(s))) res.series.push({ t: +m[1], s: m[2] === '-inf' ? -70 : +m[2] });
    var sum = s.slice(s.lastIndexOf('Summary:'));
    if ((m = sum.match(/I:\s*(-?[\d.]+)\s*LUFS/))) res.integrated = +m[1];
    if ((m = sum.match(/LRA:\s*([\d.]+)\s*LU/))) res.lra = +m[1];
    if ((m = sum.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/))) res.truePeak = m[1] === '-inf' ? -Infinity : +m[1];
    return res;
  }

  // ------------------------------------------------------------------ planning

  /*
   * Loan's long-video protocol, counted from the Friday release (S).
   */
  var PROTOCOL = [
    { d: -30, id: 'sujet', label: 'Sujet verrouillé (titre + miniature d\'abord)' },
    { d: -22, id: 'ecriture', label: 'Fin de l\'écriture (fiches scène par scène)' },
    { d: -19, id: 'tournage', label: 'Tournage terminé (dérush large chaque soir)' },
    { d: -7, id: 'montage', label: 'Montage fini → feedbacks + miniature' },
    { d: -1, id: 'prep', label: 'Upload programmé, titre, description, Short bonus prêt' },
    { d: 0, id: 'sortie', label: 'Sortie (vendredi soir) + live' },
    { d: 2, id: 'short', label: 'Short bonus avec lien vers la vidéo' },
    { d: 7, id: 'stats', label: 'Stats J+7 : clics, rétention, ce qu\'on change' }
  ];

  function deadlines(releaseISO, todayISO) {
    if (!releaseISO) return [];
    var rel = new Date(releaseISO + 'T12:00:00'), today = todayISO ? new Date(todayISO + 'T12:00:00') : new Date();
    today.setHours(12, 0, 0, 0);
    return PROTOCOL.map(function (p) {
      var d = new Date(rel.getTime() + p.d * 86400000);
      return { id: p.id, label: p.label, date: d.toISOString().slice(0, 10), daysLeft: Math.round((d - today) / 86400000) };
    });
  }

  // Loan's "Ordre d'or" for a long video.
  var GOLDEN_ORDER = [
    { id: 'structure', label: 'Structure écrite (fil rouge, phases, rushs par phase)' },
    { id: 'derush', label: 'Dérush noté A / B / C + 15 meilleurs plans ⭐' },
    { id: 'placeholders', label: 'Placeholders pour ce qui manque (durées réalistes)' },
    { id: 'corps', label: 'Corps — assemblage brut, couper large' },
    { id: 'outro', label: 'Outro — assemblage brut, répond à la promesse' },
    { id: 'vo', label: 'Voix off (corps + outro)' },
    { id: 'musique', label: 'Musique (corps + outro), posée avant les coupes fines' },
    { id: 'rythme', label: 'Rythme et coupes fines sur les temps forts' },
    { id: 'intro', label: 'INTRO — en dernier, avec le film complet sous les yeux' },
    { id: 'color', label: 'Étalonnage sur tout le film (intro incluse)' },
    { id: 'mix', label: 'Mix : VO −6 · musique −18 · SFX −12 · master −14/−16 LUFS' },
    { id: 'verifs', label: 'Vérifs finales (placeholders, audio, textes, trous)' },
    { id: 'export', label: 'Export + feedback 1 → corrections → feedback 2' }
  ];

  var api = {
    parseTime: parseTime, fmtTime: fmtTime, fmtTC: fmtTC, fmtDuration: fmtDuration, fnv: fnv,
    parseLoopBuilder: parseLoopBuilder, parseSegments: parseSegments, parseFeedback: parseFeedback,
    layoutSegments: layoutSegments, retention: retention, emotionIssues: emotionIssues, chapters: chapters,
    parseSilences: parseSilences, speechSegments: speechSegments, dbToLevel: dbToLevel, levelToDb: levelToDb,
    gainFor: gainFor, parseEbur128: parseEbur128, deadlines: deadlines, PROTOCOL: PROTOCOL, GOLDEN_ORDER: GOLDEN_ORDER
  };
  root.LS = root.LS || {};
  root.LS.core = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
