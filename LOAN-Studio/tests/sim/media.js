// Small real media files for the simulations.
const cp = require('child_process'), path = require('path');
function sh(args) { cp.execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args)); }
function make(dir) {
  const m = {
    talk: path.join(dir, 'face-cam.mov'), broll: path.join(dir, 'broll.mov'),
    music: path.join(dir, 'musique.wav'), sfx: path.join(dir, 'whoosh.wav'), vo: path.join(dir, 'voix-off.wav')
  };
  // speech bursts 0-2 s, 3-5 s, 5.3-7 s; blanks elsewhere (10 s)
  sh(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=10', '-f', 'lavfi', '-i',
    "aevalsrc='0.5*sin(2*PI*220*t)*(lt(t,2)+between(t,3,5)+between(t,5.3,7))|0.5*sin(2*PI*220*t)*(lt(t,2)+between(t,3,5)+between(t,5.3,7))':s=48000:d=10",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', m.talk]);
  sh(['-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'anoisesrc=a=0.05:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', m.broll]);
  sh(['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*330*t)':s=48000:d=16", m.music]);
  sh(['-f', 'lavfi', '-i', "aevalsrc='0.2*sin(2*PI*880*t)':s=48000:d=1", m.sfx]);
  sh(['-f', 'lavfi', '-i', "aevalsrc='0.1*sin(2*PI*180*t)*lt(mod(t,4),3)':s=48000:d=16", m.vo]);
  return m;
}
module.exports = { make };
