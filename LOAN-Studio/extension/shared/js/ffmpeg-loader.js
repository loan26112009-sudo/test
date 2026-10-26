/* Loads the Node-side FFmpeg bridge when the panel runs inside Premiere (CEP + Node.js). */
(function (root) {
  'use strict';
  var host = root.R360.host;
  if (!host.hasNode) return;
  try {
    var p = host.require('path').join(host.extensionDir(), 'shared', 'js', 'ffmpeg.js');
    root.R360.ffmpeg = host.require(p);
  } catch (e) {
    root.R360.ffmpegLoadError = e;
  }
})(window);
