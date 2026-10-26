/* Loads the Node-side FFmpeg bridge when the panel runs inside Premiere (CEP + Node.js). */
(function (root) {
  'use strict';
  if (!root.R360.host.hasNode) return;
  try {
    var p = root.require('path').join(root.R360.host.extensionDir(), 'js', 'bridge', 'ffmpeg.js');
    root.R360.ffmpeg = root.require(p);
  } catch (e) {
    root.R360.ffmpegLoadError = e;
  }
})(window);
