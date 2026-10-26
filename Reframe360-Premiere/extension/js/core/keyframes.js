/*
 * Reframe 360 Pro — keyframe animation of the virtual camera.
 *
 * A keyframe stores { t (source-media seconds), yaw, pitch, roll, fov, dist, ease }.
 * `ease` describes the segment that LEAVES the keyframe:
 *   smooth — monotone cubic through neighbours (Insta360-style fluid camera moves, no overshoot)
 *   ease   — ease-in/ease-out (stops on each keyframe, DJI "ease" transition)
 *   linear — constant speed
 *   hold   — jump cut on the next keyframe
 * Yaw always takes the shortest path; FOV is interpolated in log space so zooms feel uniform.
 */
(function (root) {
  'use strict';

  var EASES = [
    { id: 'smooth', name: 'Fluide' },
    { id: 'ease', name: 'Ease in/out' },
    { id: 'linear', name: 'Linéaire' },
    { id: 'hold', name: 'Cut (maintien)' }
  ];
  var PARAMS = ['yaw', 'pitch', 'roll', 'lfov', 'dist'];

  function wrap180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

  var nextId = 1;

  function KeyframeTrack(keys) {
    this.keys = [];
    if (keys) this.load(keys);
  }

  KeyframeTrack.prototype.load = function (keys) {
    this.keys = (keys || []).map(function (k) {
      return { id: nextId++, t: +k.t, yaw: +k.yaw, pitch: +k.pitch, roll: +k.roll || 0, fov: +k.fov, dist: +k.dist || 0, ease: k.ease || 'smooth' };
    });
    this.sort();
  };

  KeyframeTrack.prototype.toJSON = function () {
    return this.keys.map(function (k) { return { t: k.t, yaw: k.yaw, pitch: k.pitch, roll: k.roll, fov: k.fov, dist: k.dist, ease: k.ease }; });
  };

  KeyframeTrack.prototype.sort = function () { this.keys.sort(function (a, b) { return a.t - b.t; }); };

  KeyframeTrack.prototype.find = function (t, tol) {
    tol = tol || 1e-6;
    for (var i = 0; i < this.keys.length; i++) if (Math.abs(this.keys[i].t - t) <= tol) return this.keys[i];
    return null;
  };

  // Add or update the keyframe at time t. Returns the keyframe.
  KeyframeTrack.prototype.set = function (t, cam, tol, ease) {
    var k = this.find(t, tol);
    if (!k) {
      k = { id: nextId++, t: t, ease: ease || 'smooth' };
      this.keys.push(k);
    }
    k.yaw = wrap180(cam.yaw); k.pitch = cam.pitch; k.roll = cam.roll; k.fov = cam.fov; k.dist = cam.dist;
    if (ease) k.ease = ease;
    this.sort();
    return k;
  };

  KeyframeTrack.prototype.remove = function (k) {
    var i = this.keys.indexOf(k);
    if (i >= 0) this.keys.splice(i, 1);
  };

  KeyframeTrack.prototype.byId = function (id) {
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i].id === id) return this.keys[i];
    return null;
  };

  KeyframeTrack.prototype.prev = function (t, tol) {
    tol = tol || 1e-6; var r = null;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i].t < t - tol) r = this.keys[i];
    return r;
  };
  KeyframeTrack.prototype.next = function (t, tol) {
    tol = tol || 1e-6;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i].t > t + tol) return this.keys[i];
    return null;
  };

  // Values used for interpolation (yaw unwrapped along the track).
  KeyframeTrack.prototype._values = function () {
    var out = [], prevYaw = 0;
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i];
      var yaw = i === 0 ? k.yaw : prevYaw + wrap180(k.yaw - this.keys[i - 1].yaw);
      prevYaw = yaw;
      out.push({ yaw: yaw, pitch: k.pitch, roll: k.roll, lfov: Math.log(Math.max(k.fov, 1)), dist: k.dist });
    }
    return out;
  };

  // Monotone (Fritsch–Carlson) tangent at key i for parameter p, in units per second.
  function tangent(keys, vals, i, p) {
    var n = keys.length;
    if (i === 0 || i === n - 1) return 0; // camera settles on the first/last key
    var d0 = (vals[i][p] - vals[i - 1][p]) / (keys[i].t - keys[i - 1].t);
    var d1 = (vals[i + 1][p] - vals[i][p]) / (keys[i + 1].t - keys[i].t);
    if (d0 * d1 <= 0) return 0;
    var m = (d0 + d1) / 2;
    // limit to 3x the secant slopes => no overshoot
    var lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    if (Math.abs(m) > lim) m = m > 0 ? lim : -lim;
    return m;
  }

  KeyframeTrack.prototype.evaluate = function (t, fallback) {
    var keys = this.keys, n = keys.length;
    if (!n) return fallback ? { yaw: fallback.yaw, pitch: fallback.pitch, roll: fallback.roll, fov: fallback.fov, dist: fallback.dist } : null;
    if (n === 1 || t <= keys[0].t) return pick(keys[0]);
    if (t >= keys[n - 1].t) return pick(keys[n - 1]);
    var i = 0;
    while (i < n - 2 && t >= keys[i + 1].t) i++;
    var k0 = keys[i], k1 = keys[i + 1];
    var vals = this._values();
    var dt = k1.t - k0.t;
    var u = dt > 0 ? (t - k0.t) / dt : 1;
    var out = {};
    for (var j = 0; j < PARAMS.length; j++) {
      var p = PARAMS[j], a = vals[i][p], b = vals[i + 1][p], v;
      switch (k0.ease) {
        case 'hold': v = a; break;
        case 'linear': v = a + (b - a) * u; break;
        case 'ease': var h = u * u * (3 - 2 * u); v = a + (b - a) * h; break;
        default: // smooth: cubic Hermite with monotone tangents
          var m0 = tangent(keys, vals, i, p) * dt, m1 = tangent(keys, vals, i + 1, p) * dt;
          var u2 = u * u, u3 = u2 * u;
          v = (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m1;
      }
      out[p] = v;
    }
    return { yaw: wrap180(out.yaw), pitch: out.pitch, roll: out.roll, fov: Math.exp(out.lfov), dist: out.dist };
  };

  function pick(k) { return { yaw: k.yaw, pitch: k.pitch, roll: k.roll, fov: k.fov, dist: k.dist }; }

  var api = { KeyframeTrack: KeyframeTrack, EASES: EASES };
  root.R360 = root.R360 || {};
  root.R360.keyframes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
