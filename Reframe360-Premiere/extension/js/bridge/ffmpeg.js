/*
 * Reframe 360 Pro — FFmpeg bridge (Node.js, runs inside the CEP panel or in tests).
 *
 * Decode: source (H.264/H.265/ProRes, 8 or 10 bit) -> x2rgb10le raw frames on stdout.
 * Encode: x2rgb10le raw frames on stdin -> ProRes / DNxHR / HEVC / H.264 with the source
 *         colour tags (Rec.709, Rec.2020, HLG, D-Log M ...) carried over.
 */
(function (root) {
  'use strict';

  var cp = require('child_process');
  var fs = require('fs');
  var path = require('path');
  var os = require('os');

  var IS_WIN = process.platform === 'win32';
  var SWS = 'spline+accurate_rnd+full_chroma_int+full_chroma_inp';

  var CODECS = {
    prores_hq:   { name: 'Apple ProRes 422 HQ — 10 bits (recommandé)', ext: '.mov', args: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-bits_per_mb', '8000'], pix: 'yuv422p10le' },
    prores_4444: { name: 'Apple ProRes 4444 — 10 bits 4:4:4',           ext: '.mov', args: ['-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-bits_per_mb', '8000'], pix: 'yuv444p10le' },
    dnxhr_hqx:   { name: 'Avid DNxHR HQX — 10 bits',                    ext: '.mov', args: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'], pix: 'yuv422p10le' },
    hevc_10:     { name: 'H.265 10 bits — qualité max (fichier léger)', ext: '.mp4', args: ['-c:v', 'libx265', '-preset', 'slow', '-crf', '12', '-tag:v', 'hvc1', '-x265-params', 'aq-mode=3:no-sao=1:log-level=error'], pix: 'yuv420p10le' },
    h264_hq:     { name: 'H.264 8 bits — haute qualité (compatibilité)', ext: '.mp4', args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-profile:v', 'high'], pix: 'yuv420p' }
  };

  function exists(p) { try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; } }

  function which(name) {
    var exe = IS_WIN ? name + '.exe' : name;
    var dirs = (process.env.PATH || '').split(IS_WIN ? ';' : ':');
    if (IS_WIN) dirs = dirs.concat([
      'C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links')
    ]);
    else dirs = dirs.concat(['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']);
    for (var i = 0; i < dirs.length; i++) { var p = path.join(dirs[i], exe); if (exists(p)) return p; }
    return null;
  }

  // Order: user setting -> bundled in the extension's bin/ -> PATH.
  function locate(extensionDir, custom) {
    var exe = IS_WIN ? '.exe' : '';
    var cands = [];
    if (custom) cands.push(custom);
    if (extensionDir) cands.push(path.join(extensionDir, 'bin', 'ffmpeg' + exe));
    for (var i = 0; i < cands.length; i++) {
      if (exists(cands[i])) {
        var probe = path.join(path.dirname(cands[i]), 'ffprobe' + exe);
        return { ffmpeg: cands[i], ffprobe: exists(probe) ? probe : which('ffprobe') };
      }
    }
    var f = which('ffmpeg');
    return f ? { ffmpeg: f, ffprobe: which('ffprobe') } : null;
  }

  function spawn(bin, args) {
    return cp.spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function collectStderr(proc) {
    var tail = '';
    proc.stderr.on('data', function (d) { tail = (tail + d.toString()).slice(-6000); });
    return function () { return tail.trim(); };
  }

  function run(bin, args) {
    return new Promise(function (resolve, reject) {
      var p = spawn(bin, args), out = [], err = collectStderr(p);
      p.stdout.on('data', function (d) { out.push(d); });
      p.on('error', reject);
      p.on('close', function (code) {
        if (code === 0) resolve(Buffer.concat(out));
        else reject(new Error(err() || ('ffmpeg code ' + code)));
      });
      p.stdin.end();
    });
  }

  function parseRate(s) {
    if (!s || s === '0/0') return null;
    var p = String(s).split('/');
    var num = +p[0], den = +(p[1] || 1);
    if (!num || !den) return null;
    return { num: num, den: den, fps: num / den, str: num + '/' + den };
  }

  // Normalise colour metadata so it can be passed to swscale and to the encoder.
  function colorInfo(st) {
    var space = st.color_space || '', trc = st.color_transfer || '', prim = st.color_primaries || '';
    var is2020 = /2020/.test(space) || /2020/.test(prim);
    return {
      matrix: is2020 ? 'bt2020' : 'bt709',
      range: (st.color_range === 'pc' || st.color_range === 'jpeg' || /^yuvj/.test(st.pix_fmt || '')) ? 'pc' : 'tv',
      colorspace: is2020 ? 'bt2020nc' : 'bt709',
      primaries: prim && prim !== 'unknown' ? prim : (is2020 ? 'bt2020' : 'bt709'),
      transfer: trc && trc !== 'unknown' ? trc : 'bt709'
    };
  }

  function probe(tools, file) {
    return run(tools.ffprobe || tools.ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), [
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file
    ]).then(function (buf) {
      var j = JSON.parse(buf.toString());
      var v = null, a = null;
      (j.streams || []).forEach(function (s) {
        if (s.codec_type === 'video' && !v && !(s.disposition && s.disposition.attached_pic)) v = s;
        if (s.codec_type === 'audio' && !a) a = s;
      });
      if (!v) throw new Error('Aucune piste vidéo dans ce fichier.');
      var rate = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || { num: 30, den: 1, fps: 30, str: '30/1' };
      var dur = +v.duration || +(j.format && j.format.duration) || 0;
      var bits = +v.bits_per_raw_sample || (/10|12/.test(v.pix_fmt || '') ? 10 : 8);
      var w = +v.width, h = +v.height;
      var rotate = 0;
      (v.side_data_list || []).forEach(function (sd) { if (sd.rotation) rotate = sd.rotation; });
      return {
        path: file, name: path.basename(file), width: w, height: h, rate: rate, fps: rate.fps,
        duration: dur, frames: +v.nb_frames || Math.round(dur * rate.fps),
        codec: v.codec_name, pixFmt: v.pix_fmt, bits: bits, color: colorInfo(v),
        hasAudio: !!a, audioCodec: a && a.codec_name, sampleRate: a && +a.sample_rate,
        isEquirect: Math.abs(w / h - 2) < 0.02 && !rotate, sizeBytes: +(j.format && j.format.size) || 0
      };
    });
  }

  function decodeFilter(info, extra) {
    var f = 'scale=in_color_matrix=' + info.color.matrix + ':in_range=' + info.color.range + ':flags=' + SWS;
    return extra ? extra + ',' + f : f;
  }

  // One RGBA8 frame for the live preview (equirect, resized to `width`).
  function grabFrame(tools, info, t, width, hw) {
    var w = Math.min(width, info.width) & ~1, h = Math.round(w * info.height / info.width) & ~1;
    function attempt(useHw) {
      var args = ['-v', 'error'];
      if (useHw) args.push('-hwaccel', 'auto');
      args.push('-ss', Math.max(0, t).toFixed(6), '-i', info.path, '-map', '0:v:0', '-frames:v', '1',
        '-vf', decodeFilter(info, 'scale=' + w + ':' + h + ':flags=area'), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1');
      return run(tools.ffmpeg, args).then(function (buf) {
        if (buf.length < w * h * 4) throw new Error('Image vide (fin du fichier ?)');
        return { data: new Uint8Array(buf.buffer, buf.byteOffset, w * h * 4), width: w, height: h };
      });
    }
    return attempt(hw).catch(function (e) { if (hw) return attempt(false); throw e; });
  }

  function cacheIndex(dir, start, fps, duration) {
    var total = Math.max(1, Math.ceil(duration * fps));
    return {
      start: start, fps: fps, dir: dir, total: total, done: Promise.resolve(true),
      frameFile: function (t) {
        var i = Math.max(0, Math.min(total - 1, Math.round((t - start) * fps)));
        return path.join(dir, 'f_' + ('00000' + i).slice(-6) + '.jpg');
      },
      cancel: function () {}
    };
  }

  // Background JPEG cache for smooth scrubbing / playback in the panel.
  function buildCache(tools, info, opts) {
    var dir = opts.dir, fps = opts.fps || 10, width = Math.min(opts.width || 2048, info.width);
    fs.mkdirSync(dir, { recursive: true });
    var t0 = Math.max(0, opts.start || 0), dur = opts.duration || info.duration;
    var args = ['-v', 'error', '-progress', 'pipe:1', '-nostats'];
    if (opts.hw) args.push('-hwaccel', 'auto');
    args.push('-ss', t0.toFixed(6), '-t', dur.toFixed(6), '-i', info.path, '-map', '0:v:0',
      '-vf', decodeFilter(info, 'fps=' + fps + ',scale=' + width + ':-2:flags=area'),
      '-q:v', '3', '-start_number', '0', path.join(dir, 'f_%06d.jpg'));
    var idx = cacheIndex(dir, t0, fps, dur), total = idx.total;
    var p = spawn(tools.ffmpeg, args), err = collectStderr(p);
    var cancelled = false;
    p.stdout.on('data', function (d) {
      var m = /frame=(\d+)/g, s = d.toString(), r, last = null;
      while ((r = m.exec(s))) last = +r[1];
      if (last !== null && opts.onProgress) opts.onProgress(last, total);
    });
    var done = new Promise(function (resolve, reject) {
      p.on('error', reject);
      p.on('close', function (code) {
        if (cancelled) return resolve(false);
        if (code === 0) { if (opts.onProgress) opts.onProgress(total, total); resolve(true); }
        else reject(new Error(err() || ('ffmpeg code ' + code)));
      });
    });
    idx.done = done;
    idx.cancel = function () { cancelled = true; try { p.kill(); } catch (e) {} };
    return idx;
  }

  /*
   * Splits a raw video stream into fixed-size frames with back-pressure (at most ~2 frames buffered).
   * The returned frame buffer is reused: consume it before calling read() again.
   */
  function FrameReader(stream, size) {
    var chunks = [], have = 0, ended = false, error = null, waiter = null;
    var frame = Buffer.allocUnsafe(size);
    stream.on('data', function (d) {
      chunks.push(d); have += d.length;
      if (have >= size * 2) stream.pause();
      flush();
    });
    stream.on('end', function () { ended = true; flush(); });
    stream.on('error', function (e) { error = e; flush(); });

    function take() {
      var off = 0;
      while (off < size) {
        var c = chunks[0], n = Math.min(c.length, size - off);
        c.copy(frame, off, 0, n);
        off += n;
        if (n === c.length) chunks.shift(); else chunks[0] = c.subarray(n);
      }
      have -= size;
      return frame;
    }
    function flush() {
      if (!waiter) return;
      var w = waiter;
      if (have >= size) { waiter = null; w.resolve(take()); }
      else if (error) { waiter = null; w.reject(error); }
      else if (ended) { waiter = null; w.resolve(null); }
      if (!ended && have < size * 2 && stream.isPaused()) stream.resume();
    }
    this.read = function () {
      return new Promise(function (resolve, reject) { waiter = { resolve: resolve, reject: reject }; flush(); });
    };
  }

  /*
   * Full-quality decoder: frames [t0, t0 + count / fps) as x2rgb10le.
   * The seek point is nudged a quarter frame early so the frame exactly at t0 is never dropped.
   */
  function openDecoder(tools, info, t0, count, hw) {
    var frameBytes = info.width * info.height * 4;
    var seek = Math.max(0, t0 - 0.25 / info.fps);
    var args = ['-v', 'error', '-nostdin'];
    if (hw) args.push('-hwaccel', 'auto');
    args.push('-ss', seek.toFixed(6), '-i', info.path, '-map', '0:v:0', '-frames:v', String(count),
      '-vf', decodeFilter(info, null), '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', 'pipe:1');
    var p = cp.spawn(tools.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    var err = collectStderr(p), reader = new FrameReader(p.stdout, frameBytes), procErr = null;
    var exited = new Promise(function (resolve) { p.on('close', resolve); });
    p.on('error', function (e) { procErr = e; });
    return {
      frameBytes: frameBytes,
      read: function () {
        if (procErr) return Promise.reject(procErr);
        return reader.read().then(function (b) {
          if (b) return b;
          return exited.then(function (code) {
            if (code !== 0) throw new Error('Décodage: ' + (err() || 'code ' + code));
            return null;
          });
        });
      },
      error: err,
      kill: function () { try { p.kill(); } catch (e) {} }
    };
  }

  /*
   * opts: { out, width, height, rate:{str}, codec, color, audio: {path, t0, duration} | null,
   *         sharpen: 0..1.5 }
   */
  function openEncoder(tools, opts) {
    var c = CODECS[opts.codec] || CODECS.prores_hq;
    var col = opts.color || colorInfo({});
    var vf = 'scale=out_color_matrix=' + col.matrix + ':out_range=tv:flags=' + SWS + ',format=' + c.pix;
    if (opts.sharpen > 0) vf += ',unsharp=5:5:' + opts.sharpen.toFixed(2) + ':5:5:0';
    var args = ['-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'x2rgb10le', '-video_size', opts.width + 'x' + opts.height,
      '-framerate', opts.rate.str, '-i', 'pipe:0'];
    if (opts.audio) args.push('-ss', opts.audio.t0.toFixed(6), '-t', opts.audio.duration.toFixed(6), '-i', opts.audio.path);
    args.push('-map', '0:v:0');
    if (opts.audio) args.push('-map', '1:a:0?');
    args.push('-vf', vf);
    args = args.concat(c.args);
    args.push('-color_primaries', col.primaries, '-color_trc', col.transfer, '-colorspace', col.colorspace, '-color_range', 'tv');
    if (opts.audio) args = args.concat(c.ext === '.mov' ? ['-c:a', 'pcm_s24le'] : ['-c:a', 'aac', '-b:a', '320k']);
    if (c.ext === '.mp4') args.push('-movflags', '+faststart');
    args.push('-metadata', 'comment=Reframe 360 Pro', opts.out);

    var p = spawn(tools.ffmpeg, args), err = collectStderr(p), closed = false, code = null, procErr = null;
    var closeP = new Promise(function (resolve) { p.on('close', function (c2) { closed = true; code = c2; resolve(c2); }); });
    p.on('error', function (e) { procErr = e; });
    p.stdin.on('error', function () { /* reported through exit code */ });
    return {
      write: function (u8) {
        if (procErr) return Promise.reject(procErr);
        if (closed) return Promise.reject(new Error('Encodeur arrêté: ' + err()));
        return new Promise(function (resolve, reject) {
          var buf = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
          p.stdin.write(buf, function (e) { if (e) reject(new Error('Encodeur: ' + (err() || e.message))); else resolve(); });
        });
      },
      finish: function () {
        p.stdin.end();
        return closeP.then(function (c2) { if (c2 !== 0) throw new Error('Encodage: ' + (err() || 'code ' + c2)); });
      },
      kill: function () { try { p.kill(); } catch (e) {} }
    };
  }

  function cacheRoot() { return path.join(os.tmpdir(), 'Reframe360Pro'); }

  var api = {
    CODECS: CODECS, locate: locate, probe: probe, grabFrame: grabFrame, buildCache: buildCache, cacheIndex: cacheIndex,
    openDecoder: openDecoder, openEncoder: openEncoder, colorInfo: colorInfo, parseRate: parseRate, cacheRoot: cacheRoot
  };
  root.R360 = root.R360 || {};
  root.R360.ffmpeg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
