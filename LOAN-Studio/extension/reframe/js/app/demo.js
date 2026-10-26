/* Synthetic equirectangular scene shown when no clip is loaded (and used for UI tests). */
(function (root) {
  'use strict';

  function makeDemoEquirect(w) {
    var h = w / 2, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var sky = g.createLinearGradient(0, 0, 0, h / 2);
    sky.addColorStop(0, '#0b1d3a'); sky.addColorStop(0.55, '#3a6ea8'); sky.addColorStop(1, '#f2b880');
    g.fillStyle = sky; g.fillRect(0, 0, w, h / 2);
    var ground = g.createLinearGradient(0, h / 2, 0, h);
    ground.addColorStop(0, '#5d6b3a'); ground.addColorStop(1, '#1f2614');
    g.fillStyle = ground; g.fillRect(0, h / 2, w, h / 2);

    // sun
    var sx = w * 0.62, sy = h * 0.36, sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.12);
    sun.addColorStop(0, 'rgba(255,245,220,1)'); sun.addColorStop(0.25, 'rgba(255,220,150,0.8)'); sun.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = sun; g.fillRect(sx - h * 0.12, sy - h * 0.12, h * 0.24, h * 0.24);

    // skyline
    var rnd = 12345;
    function r() { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; }
    for (var x = 0; x < w; x += w / 160) {
      var bh = (0.02 + r() * 0.09) * h, bw = w / 160 * (0.6 + r() * 0.9);
      g.fillStyle = 'rgba(' + (20 + r() * 30 | 0) + ',' + (25 + r() * 30 | 0) + ',' + (40 + r() * 30 | 0) + ',1)';
      g.fillRect(x, h / 2 - bh, bw, bh);
      g.fillStyle = 'rgba(255,214,120,0.55)';
      for (var wy = h / 2 - bh + 4; wy < h / 2 - 4; wy += 7) if (r() > 0.55) g.fillRect(x + 2, wy, 2, 3);
    }

    // graticule
    g.lineWidth = Math.max(1, w / 2048);
    for (var lon = -180; lon <= 180; lon += 15) {
      var px = (lon / 360 + 0.5) * w;
      g.strokeStyle = lon % 90 === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)';
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke();
    }
    for (var lat = -75; lat <= 75; lat += 15) {
      var py = (0.5 - lat / 180) * h;
      g.strokeStyle = lat === 0 ? 'rgba(255,230,120,0.8)' : 'rgba(255,255,255,0.16)';
      g.beginPath(); g.moveTo(0, py); g.lineTo(w, py); g.stroke();
    }
    // ground checker
    for (var gy = 0; gy < 6; gy++) for (var gx = 0; gx < 48; gx++) {
      if ((gx + gy) % 2) continue;
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(gx * w / 48, h / 2 + h / 12 * (gy + 0.4), w / 48, h / 12);
    }
    // labels
    var labels = [['AVANT', 0], ['DROITE', 90], ['ARRIÈRE', 180], ['GAUCHE', -90], ['ARRIÈRE', -180]];
    g.font = '600 ' + (h / 22 | 0) + 'px Inter, Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach(function (l) {
      var px = (l[1] / 360 + 0.5) * w;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(l[0], px + 3, h * 0.62 + 3);
      g.fillStyle = '#fff'; g.fillText(l[0], px, h * 0.62);
    });
    g.font = '500 ' + (h / 40 | 0) + 'px Inter, Segoe UI, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('CIEL ▲', w / 2, h * 0.08); g.fillText('SOL ▼', w / 2, h * 0.93);
    return c;
  }

  root.R360 = root.R360 || {};
  root.R360.demo = { makeDemoEquirect: makeDemoEquirect };
})(window);
