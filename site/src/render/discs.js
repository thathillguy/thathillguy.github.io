// Draws packed [x, y, radius, colourIndex] bodies as flat, outlined discs.
// WebGL2 instanced quads with a signed-distance circle in the fragment shader; a 2D canvas
// fallback keeps the page working where WebGL2 is unavailable.

export const PALETTE = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];

const VS = `#version 300 es
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

const FS = `#version 300 es
precision mediump float;
in vec2 v_p;
in float v_r;
flat in int v_c;
uniform vec3 u_palette[4];
uniform float u_alpha;
uniform float u_outline;
out vec4 o;
void main() {
  float d = length(v_p) - v_r;
  float cover = 1.0 - smoothstep(-0.5, 0.5, d);
  float ow = u_outline * clamp(v_r * 0.25, 0.35, 1.0);
  float inner = 1.0 - smoothstep(-ow - 0.5, -ow + 0.5, d);
  vec3 fill = u_palette[v_c];
  vec3 col = mix(vec3(0.0), fill, inner);
  o = vec4(col, cover * u_alpha);
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

function createWebGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const u = {
    res: gl.getUniformLocation(prog, 'u_res'),
    ppu: gl.getUniformLocation(prog, 'u_ppu'),
    pad: gl.getUniformLocation(prog, 'u_pad'),
    alpha: gl.getUniformLocation(prog, 'u_alpha'),
    outline: gl.getUniformLocation(prog, 'u_outline'),
  };
  gl.uniform3fv(gl.getUniformLocation(prog, 'u_palette'), new Float32Array(PALETTE.flatMap(hexToRgb)));
  gl.uniform1f(u.pad, 1.5);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeInstanceBuffer = () => {
    const b = gl.createBuffer();
    return { buffer: b, capacity: 0, count: 0 };
  };
  const bind = (ib) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, ib.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
  };
  const upload = (ib, data, count) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, ib.buffer);
    const bytes = count * 16;
    if (bytes > ib.capacity) {
      ib.capacity = Math.ceil(bytes * 1.5) + 4096;
      gl.bufferData(gl.ARRAY_BUFFER, ib.capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 4);
    ib.count = count;
  };

  const bodies = makeInstanceBuffer();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(1, 1, 1, 1);

  return {
    kind: 'webgl2',
    resize(width, height, ppu) {
      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.res, width, height);
      gl.uniform1f(u.ppu, ppu);
    },
    begin() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    /** Upload (if data is given) and draw the body set. */
    bodies(data, count) {
      if (data) upload(bodies, data, count);
      if (!bodies.count) return;
      bind(bodies);
      gl.uniform1f(u.alpha, 1);
      gl.uniform1f(u.outline, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bodies.count);
    },
    end() {},
    dispose() {
      // Keep the context alive: a canvas can only ever hand out one kind of context, so a
      // remounted component must be able to get this same WebGL2 context back.
      gl.deleteProgram(prog);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(bodies.buffer);
      gl.deleteVertexArray(vao);
    },
  };
}

function create2D(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas has no usable rendering context');
  let width = 1, height = 1, ppu = 1;
  let kept = null, keptCount = 0;
  const TAU = Math.PI * 2;
  const draw = (data, count, alpha, outline) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(0.5, outline);
    ctx.strokeStyle = '#000';
    for (let i = 0, k = 0; i < count; i++, k += 4) {
      const x = data[k] * ppu + width / 2, y = data[k + 1] * ppu + height / 2, r = data[k + 2] * ppu;
      ctx.fillStyle = PALETTE[data[k + 3] | 0];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (r > 1.5 && outline > 0) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
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
      if (kept) draw(kept, keptCount, 1, 1);
    },
    end() {},
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
