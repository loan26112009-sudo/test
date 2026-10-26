/*
 * Reframe 360 Pro — render loop: decoder -> GPU reframe -> encoder.
 * IO is injected so the same loop runs inside Premiere (CEP + Node) and in automated tests.
 */
(function (root) {
  'use strict';

  /*
   * job: {
   *   renderer (R360.Reframer), decoder ({read, kill}), encoder ({write, finish, kill}),
   *   srcW, srcH, outW, outH, fps, t0, count,
   *   camAt(t) -> {yaw,pitch,roll,fov,dist}, corr,
   *   filter, ss ('auto' | 1..4), motionBlur: { enabled, shutter (deg), samples },
   *   onProgress(done, count, fps), isCancelled()
   * }
   */
  async function renderJob(job) {
    var M = root.R360.math;
    var outBytes = job.outW * job.outH * 4;
    var pool = [new Uint8Array(outBytes), new Uint8Array(outBytes)];
    var pending = [Promise.resolve(), Promise.resolve()];
    var startTime = Date.now();
    var mb = job.motionBlur || {};
    var nSamples = mb.enabled ? Math.max(2, Math.min(root.R360.Reframer.MAX_SAMPLES, mb.samples || 8)) : 1;
    var shutter = mb.enabled ? (mb.shutter || 180) / 360 / job.fps : 0;

    function samplesAt(t) {
      var cam = job.camAt(t), list = [];
      for (var k = 0; k < nSamples; k++) {
        var c = nSamples === 1 ? cam : job.camAt(t + ((k + 0.5) / nSamples - 0.5) * shutter);
        list.push({ matrix: M.cameraMatrix(c, job.corr), scale: M.lensScale(c.fov, cam.dist) });
      }
      return { samples: list, cam: cam };
    }

    function ssFor(cam) {
      var ss = job.ss === 'auto' ? M.autoSupersample(job.srcW, job.outW, job.outH, cam.fov, cam.dist) : (+job.ss || 1);
      // motion blur already integrates many samples: keep the per-pixel cost bounded
      if (nSamples > 1) ss = Math.max(1, Math.min(ss, Math.floor(Math.sqrt(32 / nSamples))));
      return ss;
    }

    var i = 0;
    try {
      while (i < job.count) {
        if (job.isCancelled && job.isCancelled()) throw new Error('CANCELLED');
        var frame = await job.decoder.read();
        if (!frame) break; // source ended early: keep what we have
        job.renderer.setExportSource(frame, job.srcW, job.srcH);
        var s = samplesAt(job.t0 + i / job.fps);
        var slot = i % 2;
        await pending[slot]; // the buffer we are about to overwrite has been handed to FFmpeg
        job.renderer.renderExport({
          outW: job.outW, outH: job.outH, filter: job.filter || 'lanczos', ss: ssFor(s.cam),
          dist: s.cam.dist, samples: s.samples, bg: [0, 0, 0]
        }, pool[slot]);
        pending[slot] = job.encoder.write(pool[slot]);
        i++;
        if (job.onProgress) job.onProgress(i, job.count, i / Math.max(0.001, (Date.now() - startTime) / 1000));
      }
      if (!i) throw new Error('Décodage : aucune image lue sur cette plage.');
      await Promise.all(pending);
      job.decoder.kill();
      await job.encoder.finish();
    } catch (e) {
      job.decoder.kill();
      await job.encoder.kill();
      throw e;
    }
    return { frames: i, seconds: (Date.now() - startTime) / 1000 };
  }

  root.R360 = root.R360 || {};
  root.R360.exporter = { renderJob: renderJob };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.R360.exporter;
})(typeof window !== 'undefined' ? window : globalThis);
