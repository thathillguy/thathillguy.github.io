// Draws packed [x, y, radius, colourIndex] bodies as flat, outlined discs, then runs the frame
// through a gravitational-lensing pass around an optional "hole" under the pointer.
// WebGL2 instanced quads with a signed-distance circle in the fragment shader; a 2D canvas
// fallback keeps the page working where WebGL2 is unavailable.

export const PALETTE = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];

const DISC_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;
uniform vec2 u_res;
uniform float u_ppu;
uniform float u_pad;
out vec2 v_p;
out float v_r;
flat out int v_c;
void main() {
  float rpx = a_inst.z * u_ppu;
  float ext = rpx + u_pad;
  vec2 centre = a_inst.xy * u_ppu + u_res * 0.5;
  vec2 px = centre + a_corner * ext;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_p = a_corner * ext;
  v_r = rpx;
  v_c = int(a_inst.w + 0.5);
}`;

const DISC_FS = `#version 300 es
precision mediump float;
in vec2 v_p;
in float v_r;
flat in int v_c;
uniform vec3 u_palette[4];
out vec4 o;
void main() {
  float d = length(v_p) - v_r;
  float cover = 1.0 - smoothstep(-0.5, 0.5, d);
  float ow = clamp(v_r * 0.25, 0.35, 1.0);
  float inner = 1.0 - smoothstep(-ow - 0.5, -ow + 0.5, d);
  vec3 col = mix(vec3(0.0), u_palette[v_c], inner);
  o = vec4(col, cover);
}`;

const LENS_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

// Thin-lens bending: a pixel at image position p shows the source at p - d_hat * rE^2 / r.
// The Einstein radius rE maps the hole's centre onto a ring; inside it the image inverts.
const LENS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_res;
uniform vec2 u_hole;
uniform float u_rE;
uniform float u_rH;
uniform float u_k;
out vec4 o;
void main() {
  vec2 p = v_uv * u_res;
  if (u_k <= 0.0) { o = texture(u_scene, v_uv); return; }
  vec2 d = p - u_hole;
  float r = max(length(d), 1e-3);
  float rE = u_rE * u_k;
  float rH = u_rH * u_k;
  vec2 src = p - d / r * (rE * rE / r);
  vec3 col = texture(u_scene, src / u_res).rgb;
  if (any(lessThan(src, vec2(0.0))) || any(greaterThan(src, u_res))) col = vec3(1.0);
  float ring = exp(-pow((r - rE) / (0.10 * rE + 0.6), 2.0)) * 0.28 * u_k;
  col = mix(col, vec3(0.0), ring);
  float halo = exp(-r / (rE * 1.6)) * 0.10 * u_k;
  col = mix(col, vec3(0.0), halo);
  float core = 1.0 - smoothstep(rH * 0.85, rH * 1.15, r);
  col = mix(col, vec3(0.0), core);
  o = vec4(col, 1.0);
}`;

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

function createWebGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  // --- discs ---
  const discProg = program(gl, DISC_VS, DISC_FS);
  gl.useProgram(discProg);
  const du = {
    res: gl.getUniformLocation(discProg, 'u_res'),
    ppu: gl.getUniformLocation(discProg, 'u_ppu'),
    pad: gl.getUniformLocation(discProg, 'u_pad'),
  };
  gl.uniform3fv(gl.getUniformLocation(discProg, 'u_palette'), new Float32Array(PALETTE.flatMap(hexToRgb)));
  gl.uniform1f(du.pad, 1.5);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const discVao = gl.createVertexArray();
  gl.bindVertexArray(discVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = { buffer: gl.createBuffer(), capacity: 0, count: 0 };
  gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(1, 1);

  // --- lens pass ---
  const lensProg = program(gl, LENS_VS, LENS_FS);
  gl.useProgram(lensProg);
  const lu = {
    scene: gl.getUniformLocation(lensProg, 'u_scene'),
    res: gl.getUniformLocation(lensProg, 'u_res'),
    hole: gl.getUniformLocation(lensProg, 'u_hole'),
    rE: gl.getUniformLocation(lensProg, 'u_rE'),
    rH: gl.getUniformLocation(lensProg, 'u_rH'),
    k: gl.getUniformLocation(lensProg, 'u_k'),
  };
  gl.uniform1i(lu.scene, 0);
  const lensVao = gl.createVertexArray();
  gl.bindVertexArray(lensVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.clearColor(1, 1, 1, 1);
  let width = 1, height = 1;
  const lens = { x: 0, y: 0, rE: 0, rH: 0, k: 0 };

  return {
    kind: 'webgl2',
    resize(w, h, ppu) {
      width = w; height = h;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.useProgram(discProg);
      gl.uniform2f(du.res, w, h);
      gl.uniform1f(du.ppu, ppu);
      gl.useProgram(lensProg);
      gl.uniform2f(lu.res, w, h);
    },
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    },
    /** Upload (if data is given) and draw the body set into the scene texture. */
    bodies(data, count) {
      gl.useProgram(discProg);
      gl.bindVertexArray(discVao);
      if (data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
        const bytes = count * 16;
        if (bytes > inst.capacity) {
          inst.capacity = Math.ceil(bytes * 1.5) + 4096;
          gl.bufferData(gl.ARRAY_BUFFER, inst.capacity, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 4);
        inst.count = count;
      }
      if (inst.count) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.count);
    },
    /** Lens the frame around (x, y) in device pixels, y down; k in 0..1 is the strength. */
    lens(x, y, rE, rH, k) {
      lens.x = x; lens.y = height - y; lens.rE = rE; lens.rH = rH; lens.k = k;
    },
    end() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.useProgram(lensProg);
      gl.bindVertexArray(lensVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(lu.hole, lens.x, lens.y);
      gl.uniform1f(lu.rE, lens.rE);
      gl.uniform1f(lu.rH, lens.rH);
      gl.uniform1f(lu.k, lens.k);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      // Keep the context alive: a canvas can only ever hand out one kind of context, so a
      // remounted component must be able to get this same WebGL2 context back.
      gl.deleteProgram(discProg);
      gl.deleteProgram(lensProg);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(inst.buffer);
      gl.deleteVertexArray(discVao);
      gl.deleteVertexArray(lensVao);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
    },
  };
}

function create2D(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas has no usable rendering context');
  let width = 1, height = 1, ppu = 1;
  let kept = null, keptCount = 0;
  const lens = { x: 0, y: 0, rH: 0, k: 0 };
  const TAU = Math.PI * 2;
  return {
    kind: '2d',
    resize(w, h, p) { width = w; height = h; ppu = p; },
    begin() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    },
    bodies(data, count) {
      if (data) { kept = data.slice(0, count * 4); keptCount = count; }
      if (!kept) return;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000';
      for (let i = 0, k = 0; i < keptCount; i++, k += 4) {
        const x = kept[k] * ppu + width / 2, y = kept[k + 1] * ppu + height / 2, r = kept[k + 2] * ppu;
        ctx.fillStyle = PALETTE[kept[k + 3] | 0];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (r > 1.5) ctx.stroke();
      }
    },
    lens(x, y, rE, rH, k) { lens.x = x; lens.y = y; lens.rH = rH; lens.k = k; },
    end() {
      if (lens.k <= 0) return;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(lens.x, lens.y, lens.rH * lens.k, 0, TAU);
      ctx.fill();
    },
    dispose() {},
  };
}

export function createDiscRenderer(canvas) {
  try {
    const r = createWebGL(canvas);
    if (r) return r;
  } catch (err) {
    console.warn('WebGL2 renderer unavailable, using 2D canvas:', err);
  }
  return create2D(canvas);
}
