/*
 * Reframe 360 Pro — WebGL2 reprojection engine.
 *
 * Two pipelines share the exact same projection maths (see core/math.js):
 *   - Preview: 8-bit texture, hardware trilinear filtering with wrap-aware gradients (fast, live).
 *   - Export : 10-bit source packed as x2rgb10le (RGBA8UI texture, read with texelFetch),
 *              Lanczos-3 / Catmull-Rom bicubic filtering, adaptive supersampling and
 *              rotational motion blur, written back as x2rgb10le for FFmpeg. Rendered in tiles
 *              so that no single GPU command can trip the Windows driver watchdog (TDR).
 */
(function (root) {
  'use strict';

  var MAX_SAMPLES = 16;

  var VS = [
    '#version 300 es',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var COMMON = [
    'const float PI = 3.14159265358979323846;',
    'uniform float uDist;',
    'uniform vec2 uHalf;',
    'uniform vec3 uBg;',
    // Generalised perspective ray: camera at (0,0,-d), far intersection with the unit sphere.
    'bool camRay(vec2 n, float s, out vec3 P) {',
    '  vec3 D = normalize(vec3(n * s, 1.0));',
    '  float b = -uDist * D.z;',
    '  float disc = b * b - (uDist * uDist - 1.0);',
    '  float t = -b + sqrt(max(disc, 0.0));',
    '  P = vec3(0.0, 0.0, -uDist) + t * D;',
    '  return disc >= 0.0;',
    '}',
    'vec2 dirToLL(vec3 w) { return vec2(atan(w.x, w.z), asin(clamp(w.y, -1.0, 1.0))); }'
  ].join('\n');

  var FS_PREVIEW = [
    '#version 300 es',
    'precision highp float;',
    COMMON,
    'uniform sampler2D uTex;',
    'uniform vec2 uOrigin;',
    'uniform vec2 uOutSize;',
    'uniform mat3 uRot;',
    'uniform float uScale;',
    'out vec4 o;',
    'void main(){',
    '  vec2 q = gl_FragCoord.xy - uOrigin;',
    '  vec2 n = (q / uOutSize * 2.0 - 1.0) * uHalf;',
    '  vec3 P; bool hit = camRay(n, uScale, P);',
    '  vec2 ll = dirToLL(uRot * P);',
    '  vec2 uv = vec2(ll.x / (2.0 * PI) + 0.5, 0.5 - ll.y / PI);',
    '  vec2 dx = dFdx(uv), dy = dFdy(uv);',
    '  dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);', // wrap-aware gradients (no seam line)
    '  vec3 c = textureGrad(uTex, uv, dx, dy).rgb;',
    '  o = vec4(hit ? c : uBg, 1.0);',
    '}'
  ].join('\n');

  function exportFS(filter) {
    return [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'precision highp usampler2D;',
      '#define FILTER_' + filter.toUpperCase(),
      COMMON,
      'uniform usampler2D uSrc;',
      'uniform ivec2 uSrcSize;',
      'uniform vec2 uOutSize;',
      'uniform int uSamples;',
      'uniform int uSS;',
      'uniform mat3 uRot[' + MAX_SAMPLES + '];',
      'uniform float uScale[' + MAX_SAMPLES + '];',
      'out vec4 o;',
      // Equirect texel with spherical wrap (horizontal wrap + over-the-pole reflection).
      'vec3 px(ivec2 p) {',
      '  int W = uSrcSize.x, H = uSrcSize.y;',
      '  if (p.y < 0) { p.y = -1 - p.y; p.x += W / 2; }',
      '  else if (p.y >= H) { p.y = 2 * H - 1 - p.y; p.x += W / 2; }',
      '  p.y = clamp(p.y, 0, H - 1);',
      '  if (p.x < 0) p.x += W * ((-p.x) / W + 1);', // % on negative ints is undefined in GLSL ES
      '  p.x = p.x % W;',
      '  uvec4 b = texelFetch(uSrc, p, 0);',
      '  uint w = b.r | (b.g << 8) | (b.b << 16) | (b.a << 24);',
      '  return vec3(float((w >> 20) & 1023u), float((w >> 10) & 1023u), float(w & 1023u)) * (1.0 / 1023.0);',
      '}',
      '#ifdef FILTER_LANCZOS',
      'float lz(float x) {',
      '  x = abs(x); if (x < 1e-5) return 1.0; if (x >= 3.0) return 0.0;',
      '  float a = PI * x; return 3.0 * sin(a) * sin(a / 3.0) / (a * a);',
      '}',
      'vec3 samp(vec2 uv) {',
      '  vec2 p = uv - 0.5; vec2 f = floor(p); vec2 t = p - f; ivec2 i0 = ivec2(f);',
      '  float wx[6]; float wy[6]; float sx = 0.0, sy = 0.0;',
      '  for (int i = 0; i < 6; i++) { wx[i] = lz(t.x - float(i - 2)); wy[i] = lz(t.y - float(i - 2)); sx += wx[i]; sy += wy[i]; }',
      '  vec3 acc = vec3(0.0);',
      '  for (int j = 0; j < 6; j++) {',
      '    vec3 row = vec3(0.0);',
      '    for (int i = 0; i < 6; i++) row += wx[i] * px(i0 + ivec2(i - 2, j - 2));',
      '    acc += wy[j] * row;',
      '  }',
      '  return acc / (sx * sy);',
      '}',
      '#elif defined(FILTER_BICUBIC)',
      'vec4 cr(float t) {',
      '  float t2 = t * t, t3 = t2 * t;',
      '  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);',
      '}',
      'vec3 samp(vec2 uv) {',
      '  vec2 p = uv - 0.5; vec2 f = floor(p); vec2 t = p - f; ivec2 i0 = ivec2(f);',
      '  vec4 wx = cr(t.x), wy = cr(t.y);',
      '  vec3 acc = vec3(0.0);',
      '  for (int j = 0; j < 4; j++) {',
      '    vec3 row = vec3(0.0);',
      '    for (int i = 0; i < 4; i++) row += wx[i] * px(i0 + ivec2(i - 1, j - 1));',
      '    acc += wy[j] * row;',
      '  }',
      '  return acc;',
      '}',
      '#else',
      'vec3 samp(vec2 uv) {',
      '  vec2 p = uv - 0.5; vec2 f = floor(p); vec2 t = p - f; ivec2 i0 = ivec2(f);',
      '  return mix(mix(px(i0), px(i0 + ivec2(1, 0)), t.x), mix(px(i0 + ivec2(0, 1)), px(i0 + ivec2(1, 1)), t.x), t.y);',
      '}',
      '#endif',
      'void main(){',
      '  vec2 pix = gl_FragCoord.xy;', // row 0 of the framebuffer = top row of the image
      '  vec2 srcSize = vec2(uSrcSize);',
      '  vec3 acc = vec3(0.0); float cnt = 0.0;',
      '  float inv = 1.0 / float(uSS);',
      '  for (int m = 0; m < ' + MAX_SAMPLES + '; m++) {',
      '    if (m >= uSamples) break;',
      '    for (int sy = 0; sy < 4; sy++) {',
      '      if (sy >= uSS) break;',
      '      for (int sx = 0; sx < 4; sx++) {',
      '        if (sx >= uSS) break;',
      '        vec2 q = floor(pix) + (vec2(float(sx), float(sy)) + 0.5) * inv;',
      '        vec2 n = vec2(q.x / uOutSize.x * 2.0 - 1.0, 1.0 - q.y / uOutSize.y * 2.0) * uHalf;',
      '        vec3 P; vec3 c = uBg;',
      '        if (camRay(n, uScale[m], P)) {',
      '          vec2 ll = dirToLL(uRot[m] * P);',
      '          c = samp(vec2((ll.x / (2.0 * PI) + 0.5) * srcSize.x, (0.5 - ll.y / PI) * srcSize.y));',
      '        }',
      '        acc += c; cnt += 1.0;',
      '      }',
      '    }',
      '  }',
      '  vec3 c = clamp(acc / cnt, 0.0, 1.0);',
      '  uvec3 v = uvec3(floor(c * 1023.0 + 0.5));',
      '  uint w = (v.r << 20) | (v.g << 10) | v.b;',
      '  o = vec4(float(w & 255u), float((w >> 8) & 255u), float((w >> 16) & 255u), float(w >> 24)) / 255.0;',
      '}'
    ].join('\n');
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader: ' + log);
    }
    return sh;
  }

  function program(gl, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function Reframer(canvas) {
    this.canvas = canvas || document.createElement('canvas');
    var gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 indisponible — mets à jour le pilote graphique.');
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.programs = {};
    this.previewTex = null; this.previewSize = null;
    this.srcTex = null; this.srcSize = null;
    this.fbo = null; this.fboTex = null; this.fboSize = null;
    this.lost = false;
    var self = this;
    this.canvas.addEventListener && this.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
  }

  Reframer.prototype._prog = function (key) {
    if (!this.programs[key]) this.programs[key] = program(this.gl, key === 'preview' ? FS_PREVIEW : exportFS(key));
    return this.programs[key];
  };

  Reframer.prototype.maxTextureSize = function () { return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE); };

  Reframer.prototype.gpuInfo = function () {
    var gl = this.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) + ' — ' + gl.getParameter(gl.VERSION);
  };

  // ---------- Preview ----------

  // src: HTMLImageElement | HTMLCanvasElement | ImageBitmap | {data:Uint8Array,width,height} (RGBA8)
  Reframer.prototype.setPreviewSource = function (src) {
    var gl = this.gl;
    if (!this.previewTex) this.previewTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.previewTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (src.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
      this.previewSize = [src.width, src.height];
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      this.previewSize = [src.naturalWidth || src.width, src.naturalHeight || src.height];
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  };

  // view: { matrix (row-major 3x3 camera->source), scale, dist, outW, outH } — drawn letterboxed.
  Reframer.prototype.renderPreview = function (view, rect, bg) {
    var gl = this.gl, M = root.R360.math;
    var cw = this.canvas.width, ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.04, 0.04, 0.045, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.previewTex) return;
    var pr = this._prog('preview');
    gl.useProgram(pr.p);
    // rect is top-left based (CSS-like); GL viewport is bottom-left based.
    var vy = ch - rect.y - rect.h;
    gl.viewport(rect.x, vy, rect.w, rect.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.previewTex);
    gl.uniform1i(pr.u.uTex, 0);
    gl.uniform2f(pr.u.uOrigin, rect.x, vy);
    gl.uniform2f(pr.u.uOutSize, rect.w, rect.h);
    gl.uniformMatrix3fv(pr.u.uRot, false, M.toColumnMajor(view.matrix));
    gl.uniform1f(pr.u.uScale, view.scale);
    gl.uniform1f(pr.u.uDist, view.dist);
    var he = M.halfExtent(view.outW, view.outH);
    gl.uniform2f(pr.u.uHalf, he[0], he[1]);
    bg = bg || [0, 0, 0];
    gl.uniform3f(pr.u.uBg, bg[0], bg[1], bg[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---------- Export ----------

  // data: Uint8Array of w*h*4 bytes, x2rgb10le little-endian words.
  Reframer.prototype.setExportSource = function (data, w, h) {
    var gl = this.gl;
    if (!this.srcTex || !this.srcSize || this.srcSize[0] !== w || this.srcSize[1] !== h) {
      if (this.srcTex) gl.deleteTexture(this.srcTex);
      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.srcSize = [w, h];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data);
  };

  Reframer.prototype._ensureFbo = function (w, h) {
    var gl = this.gl;
    if (this.fboSize && this.fboSize[0] === w && this.fboSize[1] === h) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); }
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplet');
    this.fboSize = [w, h];
  };

  /*
   * opts: { outW, outH, filter: 'lanczos'|'bicubic'|'bilinear', ss: 1..4, dist,
   *         samples: [{ matrix, scale }, ...] (1 = no motion blur), bg }
   * out:  Uint8Array(outW*outH*4) receiving x2rgb10le, top row first.
   */
  Reframer.prototype.renderExport = function (opts, out) {
    if (this.lost) throw new Error('Contexte GPU perdu (pilote réinitialisé). Relance le rendu.');
    var gl = this.gl, M = root.R360.math;
    var w = opts.outW, h = opts.outH;
    this._ensureFbo(w, h);
    var pr = this._prog(opts.filter || 'lanczos');
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(pr.u.uSrc, 0);
    gl.uniform2i(pr.u.uSrcSize, this.srcSize[0], this.srcSize[1]);
    gl.uniform2f(pr.u.uOutSize, w, h);
    var n = Math.min(opts.samples.length, MAX_SAMPLES);
    var mats = new Float32Array(9 * MAX_SAMPLES), scales = new Float32Array(MAX_SAMPLES);
    for (var i = 0; i < MAX_SAMPLES; i++) {
      var s = opts.samples[Math.min(i, n - 1)];
      M.toColumnMajor(s.matrix, mats, i * 9);
      scales[i] = s.scale;
    }
    gl.uniformMatrix3fv(pr.u.uRot, false, mats);
    gl.uniform1fv(pr.u.uScale, scales);
    gl.uniform1i(pr.u.uSamples, n);
    gl.uniform1i(pr.u.uSS, Math.max(1, Math.min(4, opts.ss | 0)));
    gl.uniform1f(pr.u.uDist, opts.dist);
    var he = M.halfExtent(w, h);
    gl.uniform2f(pr.u.uHalf, he[0], he[1]);
    var bg = opts.bg || [0, 0, 0];
    gl.uniform3f(pr.u.uBg, bg[0], bg[1], bg[2]);
    gl.bindVertexArray(this.vao);

    // Tile so each draw stays well under the ~2 s Windows TDR limit.
    var taps = opts.filter === 'bilinear' ? 4 : (opts.filter === 'bicubic' ? 16 : 36);
    var cost = taps * n * opts.ss * opts.ss;
    var budget = 6e7; // texel fetches per draw
    var rows = Math.max(8, Math.min(h, Math.floor(budget / (cost * w))));
    gl.enable(gl.SCISSOR_TEST);
    for (var y = 0; y < h; y += rows) {
      gl.scissor(0, y, w, Math.min(rows, h - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.flush();
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (gl.isContextLost()) throw new Error('Contexte GPU perdu pendant le rendu.');
    return out;
  };

  Reframer.MAX_SAMPLES = MAX_SAMPLES;
  root.R360 = root.R360 || {};
  root.R360.Reframer = Reframer;
})(typeof window !== 'undefined' ? window : globalThis);
