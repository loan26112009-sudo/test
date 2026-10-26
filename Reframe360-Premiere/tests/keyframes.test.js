// Unit tests for the camera maths and keyframe interpolation. Run: node tests/keyframes.test.js
const assert = require('assert');
const M = require('../extension/js/core/math.js');
const { KeyframeTrack } = require('../extension/js/core/keyframes.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('PASS ' + name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

t('rectilinear: edge of frame hits FOV/2', () => {
  const s = M.lensScale(90, 0), r = M.camRay(1, 0, s, 0);
  near(Math.atan2(r[0], r[2]) / M.DEG, 45, 1e-9);
});
t('stereographic: edge of frame hits FOV/2', () => {
  const s = M.lensScale(200, 1), r = M.camRay(1, 0, s, 1);
  near(Math.atan2(r[0], r[2]) / M.DEG, 100, 1e-9);
});
t('projectCam inverts camRay for all lens types', () => {
  for (const d of [0, 0.4, 1, 1.5]) for (const [x, y] of [[0.3, 0.1], [-0.7, 0.35], [0.05, -0.5]]) {
    const s = M.lensScale(d > 1 ? 120 : 100, d), r = M.camRay(x, y, s, d), p = M.projectCam(r, s, d);
    near(p[0], x, 1e-9); near(p[1], y, 1e-9);
  }
});
t('camera matrix: yaw right / pitch up conventions', () => {
  const f = M.matVec(M.cameraMatrix({ yaw: 90, pitch: 0, roll: 0 }), [0, 0, 1]);
  near(f[0], 1); near(f[2], 0);
  const u = M.matVec(M.cameraMatrix({ yaw: 0, pitch: 30, roll: 0 }), [0, 0, 1]);
  near(Math.asin(u[1]) / M.DEG, 30);
});
t('FOV never exceeds what the lens can show', () => {
  near(M.effectiveFov(250, 0), 179, 1e-9);
  assert.ok(M.effectiveFov(250, 0.5) > 200);
});
t('auto supersampling grows when downscaling', () => {
  assert.strictEqual(M.autoSupersample(7680, 3840, 2160, 75, 0), 1);
  assert.ok(M.autoSupersample(7680, 1080, 1920, 150, 0.68) >= 2);
});
t('keyframes: yaw takes the shortest path across ±180°', () => {
  const k = new KeyframeTrack();
  k.set(0, { yaw: 170, pitch: 0, roll: 0, fov: 90, dist: 0 }, 1e-3, 'linear');
  k.set(1, { yaw: -170, pitch: 0, roll: 0, fov: 90, dist: 0 }, 1e-3, 'linear');
  near(Math.abs(k.evaluate(0.5).yaw), 180, 1e-9);
});
t('keyframes: smooth mode never overshoots (monotone)', () => {
  const k = new KeyframeTrack();
  [[0, 0], [1, 10], [2, 80], [3, 81], [4, 30]].forEach(([tt, p]) => k.set(tt, { yaw: 0, pitch: p, roll: 0, fov: 90, dist: 0 }, 1e-3));
  for (let x = 0; x <= 4; x += 0.01) {
    const p = k.evaluate(x).pitch;
    assert.ok(p >= -1e-9 && p <= 81 + 1e-9, 'overshoot at ' + x + ': ' + p);
  }
  near(k.evaluate(2).pitch, 80); // passes exactly through keys
});
t('keyframes: hold, ease and update in place', () => {
  const k = new KeyframeTrack();
  k.set(0, { yaw: 0, pitch: 0, roll: 0, fov: 60, dist: 0 }, 1e-3, 'hold');
  k.set(2, { yaw: 40, pitch: 0, roll: 0, fov: 120, dist: 1 }, 1e-3, 'ease');
  near(k.evaluate(1.99).yaw, 0);
  k.keys[0].ease = 'ease';
  near(k.evaluate(1).yaw, 20);
  near(k.evaluate(1).fov, Math.sqrt(60 * 120), 1e-9); // zoom interpolated in log space
  k.set(2.0004, { yaw: 50, pitch: 0, roll: 0, fov: 120, dist: 1 }, 1e-3);
  assert.strictEqual(k.keys.length, 2);
  near(k.evaluate(5).yaw, 50);
});
t('keyframes: JSON round trip', () => {
  const k = new KeyframeTrack();
  k.set(0.5, { yaw: 12, pitch: -3, roll: 1, fov: 100, dist: 0.2 }, 1e-3, 'linear');
  const k2 = new KeyframeTrack(JSON.parse(JSON.stringify(k.toJSON())));
  assert.deepStrictEqual(k2.toJSON(), k.toJSON());
});
console.log(n + ' tests passed');
