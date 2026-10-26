/*
 * Reframe 360 Pro — core math (pure JS, shared by the panel, the GPU renderer and the tests).
 *
 * Conventions
 *   World / camera space: +X right, +Y up, +Z forward.
 *   Equirectangular: centre of the image = forward (+Z), longitude grows to the right,
 *   u = (lon / 2PI + 0.5) * W, v = (0.5 - lat / PI) * H, pixel centres at +0.5.
 *   Camera orientation: yaw (turn right = +), pitch (look up = +), roll, applied as
 *   R = Ryaw * Rpitch * Rroll to camera-space rays.
 *
 * Lens model ("generalised perspective"): the virtual camera sits at (0,0,-d) inside/outside
 * the unit sphere and looks through a flat image plane.
 *   d = 0   -> rectilinear (normal lens, straight lines stay straight)
 *   d = 1   -> stereographic (natural ultra-wide, Tiny Planet / Rabbit Hole)
 *   d > 1   -> camera outside the sphere (Crystal Ball)
 * Every intermediate value is a smooth blend, so lens changes can be keyframed.
 */
(function (root) {
  'use strict';

  var PI = Math.PI;
  var DEG = PI / 180;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

  // 3x3 matrices are row-major arrays of 9 numbers.
  function matMul(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return r;
  }
  function matVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }
  function transpose(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
  // GLSL mat3 is column-major.
  function toColumnMajor(m, out, offset) {
    out = out || new Float32Array(9); offset = offset || 0;
    out[offset] = m[0]; out[offset + 1] = m[3]; out[offset + 2] = m[6];
    out[offset + 3] = m[1]; out[offset + 4] = m[4]; out[offset + 5] = m[7];
    out[offset + 6] = m[2]; out[offset + 7] = m[5]; out[offset + 8] = m[8];
    return out;
  }

  function rotYaw(deg) { var c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotPitch(deg) { var c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [1, 0, 0, 0, c, s, 0, -s, c]; }
  function rotRoll(deg) { var c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c, -s, 0, s, c, 0, 0, 0, 1]; }

  // Camera -> world.
  function viewMatrix(yaw, pitch, roll) { return matMul(rotYaw(yaw), matMul(rotPitch(pitch), rotRoll(roll))); }
  // World -> source sphere (global horizon / orientation fix of the whole clip).
  function correctionMatrix(corr) {
    if (!corr) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return viewMatrix(corr.yaw || 0, corr.pitch || 0, corr.roll || 0);
  }
  // Full camera -> source matrix.
  function cameraMatrix(cam, corr) { return matMul(correctionMatrix(corr), viewMatrix(cam.yaw, cam.pitch, cam.roll)); }

  // Largest half-angle the lens can show for a given distortion d.
  function maxHalfAngle(d) { return d <= 1 ? Math.acos(-d) : Math.acos(-1 / d); }

  // Image-plane half extent (along the long side of the frame) for a FOV in degrees.
  function lensScale(fovDeg, d) {
    var a = fovDeg * 0.5 * DEG;
    var amax = maxHalfAngle(d) - 0.5 * DEG;
    if (d <= 1) {
      a = Math.min(a, amax);
      return Math.sin(a) / (d + Math.cos(a));
    }
    if (a <= amax) return Math.sin(a) / (d + Math.cos(a));
    var smax = Math.sin(amax) / (d + Math.cos(amax));
    return smax * (1 + 4 * (a - amax) / amax); // zoom out further: the ball floats inside the frame
  }

  // FOV actually displayed (after clamping) — what the UI shows.
  function effectiveFov(fovDeg, d) {
    if (d > 1) return fovDeg;
    var amax = maxHalfAngle(d) - 0.5 * DEG;
    return Math.min(fovDeg, 2 * amax / DEG);
  }

  // Normalised frame extents: the long side spans [-1, 1].
  function halfExtent(w, h) { return w >= h ? [1, h / w] : [w / h, 1]; }

  // Camera-space unit ray for normalised image coords n (x right, y up) — mirrors the shader.
  function camRay(nx, ny, s, d) {
    var x = nx * s, y = ny * s, z = 1;
    var len = Math.sqrt(x * x + y * y + 1);
    x /= len; y /= len; z /= len;
    var b = -d * z, c = d * d - 1, disc = b * b - c;
    if (disc < 0) return null;
    var t = -b + Math.sqrt(disc);
    return [t * x, t * y, -d + t * z];
  }

  // Inverse of camRay: camera-space unit vector -> normalised image coords (or null if hidden).
  function projectCam(p, s, d) {
    var den = p[2] + d;
    if (den <= 1e-6) return null;
    if (d > 1) {
      // From outside the sphere only the far hemisphere (as seen through the ball) is the far hit.
      var D = [p[0], p[1], den], l = Math.sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
      D[0] /= l; D[1] /= l; D[2] /= l;
      var b = -d * D[2], disc = b * b - (d * d - 1);
      if (disc < 0) return null;
      var tf = -b + Math.sqrt(disc);
      var q = [tf * D[0], tf * D[1], -d + tf * D[2]];
      if (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-4) return null;
    }
    return [p[0] / den / s, p[1] / den / s];
  }

  function dirToLonLat(v) { return [Math.atan2(v[0], v[2]), Math.asin(clamp(v[1], -1, 1))]; }
  function dirToEquirect(v, w, h) {
    var ll = dirToLonLat(v);
    return [(ll[0] / (2 * PI) + 0.5) * w, (0.5 - ll[1] / PI) * h];
  }
  function lonLatToDir(lon, lat) {
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  }

  // Automatic supersampling factor (per axis) so that downscaling never aliases.
  function autoSupersample(srcW, outW, outH, fovDeg, d) {
    var s = lensScale(fovDeg, d);
    var srcDensity = srcW / (2 * PI);                       // source px / radian
    var outDensity = (Math.max(outW, outH) * 0.5) / (s * (d + 1)); // output px / radian at centre
    var ratio = srcDensity / outDensity;
    var ss = Math.ceil(ratio - 0.15);
    if (d >= 0.5) ss = Math.max(ss, 2); // poles get strongly minified in planet / fisheye looks
    return clamp(ss, 1, 4);
  }

  // Lens presets — DJI Reframe + Insta360 looks, plus extra ultra-wide steps.
  var PRESETS = [
    { id: 'tele',    key: '1', name: 'Télé',          fov: 40,  dist: 0 },
    { id: 'normal',  key: '2', name: 'Normal',        fov: 75,  dist: 0 },
    { id: 'wide',    key: '3', name: 'Large',         fov: 100, dist: 0.12 },
    { id: 'uwide',   key: '4', name: 'Ultra large',   fov: 125, dist: 0.4 },
    { id: 'hwide',   key: '5', name: 'Hyper large',   fov: 150, dist: 0.68 },
    { id: 'fisheye', key: '6', name: 'Fisheye',       fov: 200, dist: 1.0 },
    { id: 'planet',  key: '7', name: 'Tiny Planet',   fov: 262, dist: 1.0, pitch: -90, roll: 0 },
    { id: 'rabbit',  key: '8', name: 'Rabbit Hole',   fov: 262, dist: 1.0, pitch: 90, roll: 0 },
    { id: 'ball',    key: '9', name: 'Crystal Ball',  fov: 338, dist: 1.5, pitch: 0, roll: 0 }
  ];

  var FORMATS = [
    { id: 'seq',     name: 'Comme la séquence' },
    { id: 'uhd',     name: '16:9 — 4K UHD 3840×2160',      w: 3840, h: 2160 },
    { id: 'fhd',     name: '16:9 — Full HD 1920×1080',     w: 1920, h: 1080 },
    { id: 'c4k',     name: '17:9 — DCI 4K 4096×2160',      w: 4096, h: 2160 },
    { id: 'v4k',     name: '9:16 — Vertical 4K 2160×3840',  w: 2160, h: 3840 },
    { id: 'vfhd',    name: '9:16 — Vertical HD 1080×1920',  w: 1080, h: 1920 },
    { id: 'sq4k',    name: '1:1 — Carré 2160×2160',         w: 2160, h: 2160 },
    { id: 'sq',      name: '1:1 — Carré 1080×1080',         w: 1080, h: 1080 },
    { id: 'p45',     name: '4:5 — Portrait 1728×2160',      w: 1728, h: 2160 },
    { id: 'p45hd',   name: '4:5 — Portrait 1080×1350',      w: 1080, h: 1350 },
    { id: 'scope',   name: '2.39:1 — Cinéma 3840×1608',     w: 3840, h: 1608 },
    { id: 'u219',    name: '21:9 — Ultra-wide 5120×2160',   w: 5120, h: 2160 },
    { id: 'custom',  name: 'Personnalisé…' }
  ];

  var api = {
    PI: PI, DEG: DEG, clamp: clamp, wrap180: wrap180,
    matMul: matMul, matVec: matVec, transpose: transpose, toColumnMajor: toColumnMajor,
    rotYaw: rotYaw, rotPitch: rotPitch, rotRoll: rotRoll,
    viewMatrix: viewMatrix, correctionMatrix: correctionMatrix, cameraMatrix: cameraMatrix,
    maxHalfAngle: maxHalfAngle, lensScale: lensScale, effectiveFov: effectiveFov, halfExtent: halfExtent,
    camRay: camRay, projectCam: projectCam,
    dirToLonLat: dirToLonLat, dirToEquirect: dirToEquirect, lonLatToDir: lonLatToDir,
    autoSupersample: autoSupersample, PRESETS: PRESETS, FORMATS: FORMATS
  };

  root.R360 = root.R360 || {};
  root.R360.math = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
