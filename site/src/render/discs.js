// Draws the stars (vec4 x, y, mass, radius per star, plus a colour index) as soft points and
// discs with WebGL2 instancing, then runs the frame through a gravitational-lensing pass around
// the pointer's black hole. Blending is multiplicative, like ink on paper: where stars overlap
// the colour deepens instead of flattening, so dense regions read as tone.
// A 2D canvas fallback keeps the page working where WebGL2 is unavailable.

export const PALETTE = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];

const DISC_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;   // x, y, mass, radius (sim units)
layout(location = 2) in float a_col;   // palette index
layout(location = 3) in vec2 a_vel;    // velocity, sim units per second
uniform vec2 u_res;
uniform float u_ppu;
uniform float u_lead;                  // seconds of sim time since the physics state: extrapolate
out vec2 v_p;
out float v_r;
flat out int v_c;
void main() {
  float rpx = a_inst.w * u_ppu;
  float ext = max(rpx + 1.5, 2.6);
  vec2 centre = (a_inst.xy + a_vel * u_lead) * u_ppu + u_res * 0.5;
  vec2 px = centre + a_corner * ext;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_p = a_corner * ext;
  v_r = rpx;
  v_c = int(a_col + 0.5);
}`;

// Output is the factor the paper is multiplied by: 1 leaves it white, the fill colour inks it.
const DISC_FS = `#version 300 es
precision mediump float;
in vec2 v_p;
in float v_r;
flat in int v_c;
uniform vec3 u_palette[4];
out vec4 o;
void main() {
  vec3 fill = u_palette[v_c];
  if (v_r < 1.6) {
    // a star: a soft dot whose weight grows with its size, pure colour
    float s = max(v_r, 0.85);
    float w = exp(-0.5 * dot(v_p, v_p) / (s * s)) * clamp(0.30 + 0.45 * v_r, 0.0, 0.85);
    o = vec4(mix(vec3(1.0), fill, w), 1.0);
    return;
  }
  float d = length(v_p) - v_r;
  float cover = 1.0 - smoothstep(-0.5, 0.5, d);
  float ow = clamp(v_r * 0.25, 0.35, 1.0);
  float inner = 1.0 - smoothstep(-ow - 0.5, -ow + 0.5, d);
  vec3 col = mix(vec3(0.0), fill, inner);
  o = vec4(mix(vec3(1.0), col, cover), 1.0);
}`;

const LENS_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

// Thin-lens bending around the hole: a pixel at p shows the source at p - d_hat * rE^2 / r.
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
  if (u_k <= 0.0) { o = texture(u_scene, v_uv); return; }
  vec2 p = v_uv * u_res;
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
  float photon = exp(-pow((r - 1.5 * rH) / (0.35 + 0.05 * rH), 2.0)) * 0.55 * u_k;
  col = mix(col, vec3(0.0), photon);
  float core = 1.0 - smoothstep(rH * 0.92, rH * 1.08, r);
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

  const discProg = program(gl, DISC_VS, DISC_FS);
  gl.useProgram(discProg);
  const du = { res: gl.getUniformLocation(discProg, 'u_res'), ppu: gl.getUniformLocation(discProg, 'u_ppu'), lead: gl.getUniformLocation(discProg, 'u_lead') };
  gl.uniform3fv(gl.getUniformLocation(discProg, 'u_palette'), new Float32Array(PALETTE.flatMap(hexToRgb)));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const instBuf = gl.createBuffer(), colBuf = gl.createBuffer(), velBuf = gl.createBuffer();
  let capacity = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 8, 0);
  gl.vertexAttribDivisor(3, 1);

  const lensProg = program(gl, LENS_VS, LENS_FS);
  gl.useProgram(lensProg);
  const lu = {
    scene: gl.getUniformLocation(lensProg, 'u_scene'), res: gl.getUniformLocation(lensProg, 'u_res'),
    hole: gl.getUniformLocation(lensProg, 'u_hole'), rE: gl.getUniformLocation(lensProg, 'u_rE'),
    rH: gl.getUniformLocation(lensProg, 'u_rH'), k: gl.getUniformLocation(lensProg, 'u_k'),
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
      gl.useProgram(discProg); gl.uniform2f(du.res, w, h); gl.uniform1f(du.ppu, ppu);
      gl.useProgram(lensProg); gl.uniform2f(lu.res, w, h);
    },
    /**
     * Draw count stars from `positions` (x, y, m, r), `velocities` (vx, vy) and `colours`, moved on
     * by `lead` seconds of sim time. Pass null for data that has not changed since the last draw.
     */
    draw(positions, velocities, colours, count, lead = 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO); // multiply: ink on paper
      gl.useProgram(discProg);
      gl.bindVertexArray(vao);
      if (count > capacity) {
        capacity = Math.ceil(count * 1.2) + 1024;
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, capacity * 16, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, velBuf); gl.bufferData(gl.ARRAY_BUFFER, capacity * 8, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
      }
      if (positions) { gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions, 0, count * 4); }
      if (velocities) { gl.bindBuffer(gl.ARRAY_BUFFER, velBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, velocities, 0, count * 2); }
      if (colours) { gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, colours, 0, count); }
      gl.uniform1f(du.lead, lead);
      if (count) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.useProgram(lensProg);
      gl.bindVertexArray(lensVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(lu.hole, lens.x, height - lens.y);
      gl.uniform1f(lu.rE, lens.rE); gl.uniform1f(lu.rH, lens.rH); gl.uniform1f(lu.k, lens.k);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    /** Lens the frame around (x, y) in device pixels, y down; k in 0..1 is the strength. */
    lens(x, y, rE, rH, k) { lens.x = x; lens.y = y; lens.rE = rE; lens.rH = rH; lens.k = k; },
    dispose() {
      // keep the context (a canvas can only hand out one kind); free what we made
      gl.deleteProgram(discProg); gl.deleteProgram(lensProg);
      gl.deleteBuffer(quad); gl.deleteBuffer(instBuf); gl.deleteBuffer(colBuf); gl.deleteBuffer(velBuf);
      gl.deleteVertexArray(vao); gl.deleteVertexArray(lensVao);
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    },
  };
}

function create2D(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas has no usable rendering context');
  let width = 1, height = 1, ppu = 1, cols = null, pos = null;
  const lens = { x: 0, y: 0, rH: 0, k: 0 };
  const TAU = Math.PI * 2;
  return {
    kind: '2d',
    resize(w, h, p) { width = w; height = h; ppu = p; },
    draw(positions, velocities, colours, count, lead = 0) {
      if (colours) cols = colours;
      if (positions) pos = positions;
      positions = pos;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      for (let i = 0, k = 0; i < count; i++, k += 4) {
        if (!positions) break;
        const x = positions[k] * ppu + width / 2, y = positions[k + 1] * ppu + height / 2, r = Math.max(positions[k + 3] * ppu, 0.6);
        ctx.fillStyle = PALETTE[cols ? cols[i] | 0 : 0];
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      if (lens.k > 0) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(lens.x, lens.y, lens.rH * lens.k, 0, TAU); ctx.fill(); }
    },
    lens(x, y, rE, rH, k) { lens.x = x; lens.y = y; lens.rH = rH; lens.k = k; },
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
