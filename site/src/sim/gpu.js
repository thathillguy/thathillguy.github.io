// WebGPU engine: the stars live on the GPU and are integrated there with all-pairs gravity,
// tiled through workgroup memory. The CPU keeps the cores (exact, 64-bit) and reads positions
// back once per frame for drawing and housekeeping. Returns null where WebGPU is absent.
//
// Body layout, shared with the renderer: vec4 (x, y, mass, radius) per star.

import { HULL_MARGIN } from './fluid.js';

const WG = 256;
const MAX_CORES = 4;

const SHADER = /* wgsl */ `
struct Params { n: u32, k: u32, dt: f32, eps2: f32, mutual: f32, rewind: f32 }
struct Core { pos: vec2<f32>, m: f32, e2: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> body: array<vec4<f32>>;  // x, y, m, r
@group(0) @binding(2) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> acc: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> cores: array<Core, ${MAX_CORES}>;
@group(0) @binding(5) var<storage, read_write> react: array<vec2<f32>>; // per workgroup, per core: sum m * a_on_core
@group(0) @binding(6) var<storage, read_write> snapBody: array<vec4<f32>>;  // state when the fall began
@group(0) @binding(7) var<storage, read_write> snapVel: array<vec2<f32>>;
@group(0) @binding(8) var<storage, read_write> startBody: array<vec4<f32>>; // state when the rewind began

var<workgroup> tile: array<vec4<f32>, ${WG}>;
var<workgroup> red: array<vec2<f32>, ${WG}>;

// first half-kick with last step's acceleration, then drift
@compute @workgroup_size(${WG})
fn kickDrift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  let v = vel[i] + acc[i] * (0.5 * p.dt);
  vel[i] = v;
  body[i] = vec4<f32>(body[i].xy + v * p.dt, body[i].zw);
}

@compute @workgroup_size(${WG})
fn force(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let i = gid.x;
  let n = p.n;
  var me = vec4<f32>(0.0);
  if (i < n) { me = body[i]; }
  var a = vec2<f32>(0.0);
  let tiles = (n + ${WG}u - 1u) / ${WG}u;
  for (var t = 0u; t < tiles; t++) {
    let j0 = t * ${WG}u + lid.x;
    tile[lid.x] = select(vec4<f32>(0.0), body[j0], j0 < n);
    workgroupBarrier();
    if (i < n) {
      let limit = min(${WG}u, n - t * ${WG}u);
      var kk = 0u;
      // four pairs per iteration; the self term is exactly zero (d = 0), no branch needed
      for (; kk + 4u <= limit; kk += 4u) {
        let o0 = tile[kk]; let o1 = tile[kk + 1u]; let o2 = tile[kk + 2u]; let o3 = tile[kk + 3u];
        let d0 = o0.xy - me.xy; let q0 = dot(d0, d0) + p.eps2; let s0 = inverseSqrt(q0);
        let d1 = o1.xy - me.xy; let q1 = dot(d1, d1) + p.eps2; let s1 = inverseSqrt(q1);
        let d2 = o2.xy - me.xy; let q2 = dot(d2, d2) + p.eps2; let s2 = inverseSqrt(q2);
        let d3 = o3.xy - me.xy; let q3 = dot(d3, d3) + p.eps2; let s3 = inverseSqrt(q3);
        a += d0 * (o0.z * s0 * s0 * s0) + d1 * (o1.z * s1 * s1 * s1) + d2 * (o2.z * s2 * s2 * s2) + d3 * (o3.z * s3 * s3 * s3);
      }
      for (; kk < limit; kk++) {
        let o = tile[kk];
        let d = o.xy - me.xy; let q = dot(d, d) + p.eps2; let s = inverseSqrt(q);
        a += d * (o.z * s * s * s);
      }
    }
    workgroupBarrier();
  }
  a = a * p.mutual;
  // cores: exact pull on this star, and this star's pull on each core (reduced per workgroup)
  for (var c = 0u; c < p.k; c++) {
    var contrib = vec2<f32>(0.0);
    if (i < n) {
      let d = cores[c].pos - me.xy;
      let q = dot(d, d) + cores[c].e2;
      let s = inverseSqrt(q);
      let f = s * s * s;
      a += d * (cores[c].m * f);
      contrib = -d * (me.z * f);
    }
    red[lid.x] = contrib;
    workgroupBarrier();
    for (var stride = ${WG}u / 2u; stride > 0u; stride = stride / 2u) {
      if (lid.x < stride) { red[lid.x] += red[lid.x + stride]; }
      workgroupBarrier();
    }
    if (lid.x == 0u) { react[wid.x * ${MAX_CORES}u + c] = red[0]; }
    workgroupBarrier();
  }
  if (i < n) { acc[i] = a; }
}

@compute @workgroup_size(${WG})
fn kick(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  vel[i] = vel[i] + acc[i] * (0.5 * p.dt);
}

// after a fall: carried from where it lies back to the snapshot; at 1 restored exactly
@compute @workgroup_size(${WG})
fn rewind(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  if (p.rewind >= 1.0) { body[i] = snapBody[i]; vel[i] = snapVel[i]; return; }
  body[i] = vec4<f32>(mix(startBody[i].xy, snapBody[i].xy, p.rewind), body[i].zw);
  vel[i] = vec2<f32>(0.0);
}`;

// The fluid of fluid.js, on the GPU: deposit onto a grid with atomics, fold the margins, blur,
// pressure, then move each star. Its own module and bind groups, since a pipeline may only see
// eight storage buffers and the gravity kernels already use most of them.
const FLUID_SHADER = /* wgsl */ `
struct FParams {
  n: u32, cols: u32, rows: u32, cells: u32,
  h: f32, ox: f32, oy: f32, rho0: f32,
  K: f32, cohesion: f32, visc: f32, g: f32,
  strength: f32, dtf: f32, halfW: f32, halfH: f32,
  bounce: f32, hx: f32, hy: f32, hm: f32,
  he2: f32, useAcc: f32, bx: f32, by: f32,
  bc: f32, bs: f32, bhw: f32, bhh: f32,
  bvx: f32, bvy: f32, hasBoat: f32, pad1: f32,
}
@group(0) @binding(0) var<uniform> q: FParams;
@group(0) @binding(1) var<storage, read_write> body: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> acc: array<vec2<f32>>;
@group(1) @binding(0) var<storage, read_write> grid: array<atomic<i32>>; // per cell: count, mx, my, fixed point x256
@group(1) @binding(1) var<storage, read_write> dens: array<f32>;
@group(1) @binding(2) var<storage, read_write> tmp: array<f32>;
@group(1) @binding(3) var<storage, read_write> pres: array<f32>;

// fixed point for the grid sums. Rounded, not truncated: truncation loses more of the small
// weights than of the momentum they carry, which inflates the cell mean velocity, and relaxing
// toward an inflated mean pumps energy into the pool a little every substep.
const FP: f32 = 1024.0;

fn count(c: u32) -> f32 { return f32(atomicLoad(&grid[3u * c])) / FP; }

@compute @workgroup_size(${WG})
fn gridClear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= q.cells) { return; }
  atomicStore(&grid[3u * c], 0); atomicStore(&grid[3u * c + 1u], 0); atomicStore(&grid[3u * c + 2u], 0);
}

@compute @workgroup_size(${WG})
fn splat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= q.n) { return; }
  let pos = body[i].xy;
  let f = (pos - vec2<f32>(q.ox, q.oy)) / q.h - 0.5;
  let cx = u32(clamp(floor(f.x), 0.0, f32(q.cols - 2u)));
  let cy = u32(clamp(floor(f.y), 0.0, f32(q.rows - 2u)));
  let t = clamp(f - vec2<f32>(f32(cx), f32(cy)), vec2<f32>(0.0), vec2<f32>(1.0));
  let c = cy * q.cols + cx;
  let v = vel[i];
  let w = vec4<f32>((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  let cs = vec4<u32>(c, c + 1u, c + q.cols, c + q.cols + 1u);
  for (var k = 0u; k < 4u; k++) {
    let cc = cs[k]; let wk = w[k] * FP;
    atomicAdd(&grid[3u * cc], i32(round(wk)));
    atomicAdd(&grid[3u * cc + 1u], i32(round(wk * v.x)));
    atomicAdd(&grid[3u * cc + 2u], i32(round(wk * v.y)));
  }
}

// margins lie beyond the walls: fold them onto the edge cells and zero them
@compute @workgroup_size(${WG})
fn fold(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= q.cells) { return; }
  let cx = c % q.cols; let cy = c / q.cols;
  if (cx == 0u || cx == q.cols - 1u || cy == 0u || cy == q.rows - 1u) { dens[c] = 0.0; return; }
  var d = count(c);
  let l = cx == 1u; let r = cx == q.cols - 2u; let tp = cy == 1u; let b = cy == q.rows - 2u;
  if (l) { d += count(c - 1u); } if (r) { d += count(c + 1u); }
  if (tp) { d += count(c - q.cols); } if (b) { d += count(c + q.cols); }
  if (l && tp) { d += count(c - q.cols - 1u); } if (r && tp) { d += count(c - q.cols + 1u); }
  if (l && b) { d += count(c + q.cols - 1u); } if (r && b) { d += count(c + q.cols + 1u); }
  dens[c] = d;
}

@compute @workgroup_size(${WG})
fn blurX(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= q.cells) { return; }
  let cx = i32(c % q.cols); let o = c - u32(cx);
  let lo = 1; let hi = i32(q.cols) - 2;
  tmp[c] = (dens[o + u32(clamp(cx - 2, lo, hi))] + 4.0 * dens[o + u32(clamp(cx - 1, lo, hi))] + 6.0 * dens[o + u32(clamp(cx, lo, hi))]
          + 4.0 * dens[o + u32(clamp(cx + 1, lo, hi))] + dens[o + u32(clamp(cx + 2, lo, hi))]) / 16.0;
}

@compute @workgroup_size(${WG})
fn blurY(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= q.cells) { return; }
  let cx = c % q.cols; let cy = i32(c / q.cols);
  let lo = 1; let hi = i32(q.rows) - 2;
  let sm = (tmp[u32(clamp(cy - 2, lo, hi)) * q.cols + cx] + 4.0 * tmp[u32(clamp(cy - 1, lo, hi)) * q.cols + cx] + 6.0 * tmp[u32(clamp(cy, lo, hi)) * q.cols + cx]
          + 4.0 * tmp[u32(clamp(cy + 1, lo, hi)) * q.cols + cx] + tmp[u32(clamp(cy + 2, lo, hi)) * q.cols + cx]) / 16.0;
  pres[c] = q.K * max(sm / q.rho0 - 1.0, -q.cohesion);
}

@compute @workgroup_size(${WG})
fn fluid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= q.n) { return; }
  let pos = body[i].xy;
  let f = (pos - vec2<f32>(q.ox, q.oy)) / q.h - 0.5;
  let cx = u32(clamp(floor(f.x), 1.0, f32(q.cols - 3u)));
  let cy = u32(clamp(floor(f.y), 1.0, f32(q.rows - 3u)));
  let t = clamp(f - vec2<f32>(f32(cx), f32(cy)), vec2<f32>(0.0), vec2<f32>(1.0));
  let c = cy * q.cols + cx;
  let w = vec4<f32>((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  let cs = vec4<u32>(c, c + 1u, c + q.cols, c + q.cols + 1u);
  var gr = vec2<f32>(0.0); var cnt = 0.0; var su = vec2<f32>(0.0);
  for (var k = 0u; k < 4u; k++) {
    let cc = cs[k]; let wk = w[k];
    gr += wk * vec2<f32>(pres[cc + 1u] - pres[cc - 1u], pres[cc + q.cols] - pres[cc - q.cols]);
    cnt += wk * f32(atomicLoad(&grid[3u * cc]));
    su += wk * vec2<f32>(f32(atomicLoad(&grid[3u * cc + 1u])), f32(atomicLoad(&grid[3u * cc + 2u])));
  }
  var v = vel[i];
  let ps = q.strength * q.strength; // pressure and viscosity arrive after gravity (see fluid.js)
  if (cnt > 1e-3) { v += q.visc * ps * (su / cnt - v); }
  var a = vec2<f32>(0.0, q.g * q.strength) - gr * (ps * 0.5 / q.h);
  if (q.useAcc > 0.5) { a += acc[i]; }
  else if (q.hm > 0.0) {
    let d = vec2<f32>(q.hx, q.hy) - pos; let qq = dot(d, d) + q.he2; let s = inverseSqrt(qq);
    a += d * (q.hm * s * s * s);
  }
  v += a * q.dtf;
  var np = pos + v * q.dtf;
  let left = -q.halfW + 0.3; let right = q.halfW - 0.3; let floor = q.halfH - 0.3;
  if (np.x < left) { np.x = left; if (v.x < 0.0) { v.x = -v.x * q.bounce; } }
  else if (np.x > right) { np.x = right; if (v.x > 0.0) { v.x = -v.x * q.bounce; } }
  if (np.y > floor) { np.y = floor; if (v.y > 0.0) { v.y = -v.y * q.bounce; } }
  if (q.hasBoat > 0.5) {
    // inside the hull? push out through the nearest face, taking the hull's velocity
    let d = np - vec2<f32>(q.bx, q.by);
    let l = vec2<f32>(q.bc * d.x + q.bs * d.y, -q.bs * d.x + q.bc * d.y);
    let e = vec2<f32>(q.bhw, q.bhh);
    if (abs(l.x) < e.x && abs(l.y) < e.y) {
      let o = e - abs(l);
      var nl = vec2<f32>(0.0, select(-1.0, 1.0, l.y >= 0.0));
      if (o.x < o.y) { nl = vec2<f32>(select(-1.0, 1.0, l.x >= 0.0), 0.0); }
      let wn = vec2<f32>(q.bc * nl.x - q.bs * nl.y, q.bs * nl.x + q.bc * nl.y);
      np += wn * min(o.x, o.y);
      let rel = dot(v - vec2<f32>(q.bvx, q.bvy), wn);
      if (rel < 0.0) { v -= wn * (rel * (1.0 + q.bounce)); }
    }
  }
  vel[i] = v;
  body[i] = vec4<f32>(np, body[i].zw);
}`;

/** A WebGPU device, or null where there is none. Cheap enough to decide the star count on. */
export async function probeGpu() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return null;
  const device = await adapter.requestDevice().catch(() => null);
  if (!device) return null;
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', e.error?.message || e.error));
  return device;
}

export function createGpuEngine(device, sim) {
  const module = device.createShaderModule({ code: SHADER });
  // one explicit layout for all three kernels (an automatic layout would only list the bindings
  // each entry point touches, and the shared bind group would fail validation for the small ones)
  const st = (type) => ({ visibility: GPUShaderStage.COMPUTE, buffer: { type } });
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, ...st('uniform') }, { binding: 1, ...st('storage') }, { binding: 2, ...st('storage') },
    { binding: 3, ...st('storage') }, { binding: 4, ...st('uniform') }, { binding: 5, ...st('storage') },
    { binding: 6, ...st('storage') }, { binding: 7, ...st('storage') }, { binding: 8, ...st('storage') },
  ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipelines = {};
  for (const name of ['kickDrift', 'force', 'kick', 'rewind']) {
    pipelines[name] = device.createComputePipeline({ layout, compute: { module, entryPoint: name } });
  }
  const fmodule = device.createShaderModule({ code: FLUID_SHADER });
  const fbgl0 = device.createBindGroupLayout({ entries: [{ binding: 0, ...st('uniform') }, { binding: 1, ...st('storage') }, { binding: 2, ...st('storage') }, { binding: 3, ...st('storage') }] });
  const fbgl1 = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => ({ binding: b, ...st('storage') })) });
  const flayout = device.createPipelineLayout({ bindGroupLayouts: [fbgl0, fbgl1] });
  for (const name of ['gridClear', 'splat', 'fold', 'blurX', 'blurY', 'fluid']) {
    pipelines[name] = device.createComputePipeline({ layout: flayout, compute: { module: fmodule, entryPoint: name } });
  }

  const n = sim.n, cap = n;
  const groups = Math.ceil(n / WG);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const bodyBuf = device.createBuffer({ size: cap * 16, usage });
  const velBuf = device.createBuffer({ size: cap * 8, usage });
  const accBuf = device.createBuffer({ size: cap * 8, usage });
  const reactBuf = device.createBuffer({ size: groups * MAX_CORES * 8, usage });
  const snapBody = device.createBuffer({ size: cap * 16, usage });
  const snapVel = device.createBuffer({ size: cap * 8, usage });
  const startBody = device.createBuffer({ size: cap * 16, usage });
  const maxCells = sim.fluid.o.maxCells ** 2;
  const gridBuf = device.createBuffer({ size: maxCells * 12, usage });
  const densBuf = device.createBuffer({ size: maxCells * 4, usage });
  const tmpBuf = device.createBuffer({ size: maxCells * 4, usage });
  const presBuf = device.createBuffer({ size: maxCells * 4, usage });
  const fparams = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const coresBuf = device.createBuffer({ size: MAX_CORES * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readBody = [0, 1].map(() => device.createBuffer({ size: cap * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  const readVel = [0, 1].map(() => device.createBuffer({ size: cap * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  const readReact = [0, 1].map(() => device.createBuffer({ size: groups * MAX_CORES * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: bodyBuf } },
      { binding: 2, resource: { buffer: velBuf } },
      { binding: 3, resource: { buffer: accBuf } },
      { binding: 4, resource: { buffer: coresBuf } },
      { binding: 5, resource: { buffer: reactBuf } },
      { binding: 6, resource: { buffer: snapBody } },
      { binding: 7, resource: { buffer: snapVel } },
      { binding: 8, resource: { buffer: startBody } },
    ],
  });
  const fbg0 = device.createBindGroup({ layout: fbgl0, entries: [
    { binding: 0, resource: { buffer: fparams } }, { binding: 1, resource: { buffer: bodyBuf } },
    { binding: 2, resource: { buffer: velBuf } }, { binding: 3, resource: { buffer: accBuf } },
  ] });
  const fbg1 = device.createBindGroup({ layout: fbgl1, entries: [
    { binding: 0, resource: { buffer: gridBuf } }, { binding: 1, resource: { buffer: densBuf } },
    { binding: 2, resource: { buffer: tmpBuf } }, { binding: 3, resource: { buffer: presBuf } },
  ] });

  // initial upload from the CPU state
  const positions = new Float32Array(cap * 4); // x, y, m, r: the renderer reads this directly
  const velocities = new Float32Array(cap * 2);
  for (let i = 0; i < n; i++) {
    positions[4 * i] = sim.x[i]; positions[4 * i + 1] = sim.y[i]; positions[4 * i + 2] = sim.m[i]; positions[4 * i + 3] = sim.r[i];
    velocities[2 * i] = sim.vx[i]; velocities[2 * i + 1] = sim.vy[i];
  }
  device.queue.writeBuffer(bodyBuf, 0, positions);
  device.queue.writeBuffer(velBuf, 0, velocities);
  device.queue.writeBuffer(accBuf, 0, new Float32Array(cap * 2));

  const paramData = new ArrayBuffer(48);
  const coreData = new Float32Array(MAX_CORES * 4);
  const reaction = new Float64Array(MAX_CORES * 2); // latest known star pull on each core
  let flip = 0;
  let primed = false;
  let rewindS = 0;

  const writeParams = () => {
    new Uint32Array(paramData, 0, 2).set([n, sim.k]);
    new Float32Array(paramData, 8, 4).set([sim.o.dt, sim.o.softening ** 2, 1 - sim.fall, rewindS]);
    device.queue.writeBuffer(params, 0, paramData);
  };
  const fdata = new ArrayBuffer(144);
  const writeFluidParams = (useAcc) => {
    const f = sim.fluid, o = f.o, hole = sim.hole, b = sim.boat;
    new Uint32Array(fdata, 0, 4).set([n, f.cols, f.rows, f.cols * f.rows]);
    new Float32Array(fdata, 16, 28).set([
      f.h, f.ox, f.oy, f.rho0, o.K, o.cohesion, o.visc, o.g, sim.fall, sim.o.dt / o.substeps, sim.halfW, sim.halfH, o.bounce,
      hole == null ? 0 : sim.cx[hole], hole == null ? 0 : sim.cy[hole], hole == null ? 0 : sim.cm[hole], hole == null ? 1 : sim.ce2[hole], useAcc ? 1 : 0,
      b ? b.x : 0, b ? b.y : 0, b ? b.c : 1, b ? b.s : 0, b ? b.hw + HULL_MARGIN : 0, b ? b.hh + HULL_MARGIN : 0, b ? b.vx : 0, b ? b.vy : 0, b ? 1 : 0, 0,
    ]);
    device.queue.writeBuffer(fparams, 0, fdata);
  };
  const writeCores = () => {
    coreData.fill(0);
    // a core's pull on the stars fades with a fall, except the pointer's hole
    for (let c = 0; c < sim.k; c++) { coreData[4 * c] = sim.cx[c]; coreData[4 * c + 1] = sim.cy[c]; coreData[4 * c + 2] = sim.cm[c] * (c === sim.hole ? 1 : 1 - sim.fall); coreData[4 * c + 3] = sim.ce2[c]; }
    device.queue.writeBuffer(coresBuf, 0, coreData);
  };

  // Core accelerations: exact core-core terms plus the latest reduced star reaction.
  const coreAccel = () => {
    const { k, cx, cy, cax, cay, cm, ce2 } = sim;
    for (let c = 0; c < k; c++) { const w = c === sim.hole ? 1 : 1 - sim.fall; cax[c] = w * reaction[2 * c] / cm[c]; cay[c] = w * reaction[2 * c + 1] / cm[c]; }
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const dx = cx[b] - cx[a], dy = cy[b] - cy[a];
        const q = dx * dx + dy * dy + ce2[a] + ce2[b];
        const inv = 1 / (q * Math.sqrt(q));
        cax[a] += inv * cm[b] * dx; cay[a] += inv * cm[b] * dy;
        cax[b] -= inv * cm[a] * dx; cay[b] -= inv * cm[a] * dy;
      }
    }
  };

  const dispatch = (enc, name) => {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
  };
  const dispatchFluid = (enc, name, count) => {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, fbg0);
    pass.setBindGroup(1, fbg1);
    pass.dispatchWorkgroups(Math.ceil(count / WG));
    pass.end();
  };

  return {
    kind: 'webgpu',
    positions,
    velocities,
    get count() { return n; },

    /** Run `steps` physics steps and refresh `positions`; resolves when the readback is in. */
    async advance(steps) {
      const h = sim.o.dt / 2;
      if (!primed) {
        // initial accelerations for the first half-kick (the CPU side skipped its own)
        writeParams(); writeCores();
        const enc = device.createCommandEncoder();
        dispatch(enc, 'force');
        device.queue.submit([enc.finish()]);
        primed = true;
      }
      for (let s = 0; s < steps; s++) {
        const enc = device.createCommandEncoder();
        if (sim.snapshotRequested) { // the fall begins: keep this state to come back to
          enc.copyBufferToBuffer(bodyBuf, 0, snapBody, 0, n * 16);
          enc.copyBufferToBuffer(velBuf, 0, snapVel, 0, n * 8);
          sim.snapshotRequested = false;
        }
        if (sim.rewindRequested) { enc.copyBufferToBuffer(bodyBuf, 0, startBody, 0, n * 16); sim.rewindRequested = false; }
        if (sim.rewind) {
          rewindS = sim._rewindProgress();
          writeParams();
          dispatch(enc, 'rewind');
          if (rewindS >= 1) { sim.finishRewind(false); writeCores(); dispatch(enc, 'force'); }
          sim.time += sim.o.dt;
        } else if (sim.fall > 0) {
          // fallen: residual gravity (and the hole) from the force kernel while any remains, then
          // the fluid's substeps; the unseen cores hold still
          const mu = 1 - sim.fall;
          sim.fluid.fit(sim.halfW, sim.halfH, n, sim.o.poolFraction);
          const cells = sim.fluid.cols * sim.fluid.rows;
          rewindS = 0;
          writeParams(); writeCores(); writeFluidParams(mu > 1e-3);
          if (mu > 1e-3) { coreAccel(); dispatch(enc, 'force'); }
          for (let t = 0; t < sim.fluid.o.substeps; t++) {
            dispatchFluid(enc, 'gridClear', cells);
            dispatchFluid(enc, 'splat', n);
            dispatchFluid(enc, 'fold', cells);
            dispatchFluid(enc, 'blurX', cells);
            dispatchFluid(enc, 'blurY', cells);
            dispatchFluid(enc, 'fluid', n);
          }
          sim.time += sim.o.dt;
        } else {
          coreAccel();
          sim.driftCores(sim.o.dt); // cores half-kick + drift, in step with the stars
          rewindS = 0;
          writeParams();
          writeCores();
          dispatch(enc, 'kickDrift');
          dispatch(enc, 'force');
          dispatch(enc, 'kick');
        }
        if (s === steps - 1) {
          enc.copyBufferToBuffer(bodyBuf, 0, readBody[flip], 0, n * 16);
          enc.copyBufferToBuffer(velBuf, 0, readVel[flip], 0, n * 8);
          enc.copyBufferToBuffer(reactBuf, 0, readReact[flip], 0, groups * MAX_CORES * 8);
        }
        device.queue.submit([enc.finish()]);
        if (!sim.rewind && !(sim.fall > 0)) { coreAccel(); sim.kickCores(h); }
        sim.stats.steps++;
      }
      const rb = readBody[flip], rv = readVel[flip], rr = readReact[flip];
      flip ^= 1;
      await Promise.all([rb.mapAsync(GPUMapMode.READ, 0, n * 16), rv.mapAsync(GPUMapMode.READ, 0, n * 8), rr.mapAsync(GPUMapMode.READ)]);
      positions.set(new Float32Array(rb.getMappedRange(0, n * 16)));
      rb.unmap();
      velocities.set(new Float32Array(rv.getMappedRange(0, n * 8)));
      rv.unmap();
      const parts = new Float32Array(rr.getMappedRange());
      reaction.fill(0);
      for (let g = 0; g < groups; g++) for (let c = 0; c < sim.k; c++) { reaction[2 * c] += parts[(g * MAX_CORES + c) * 2]; reaction[2 * c + 1] += parts[(g * MAX_CORES + c) * 2 + 1]; }
      rr.unmap();

      // housekeeping on the CPU copy: escapes and swallows respawn, then the few changed stars go back up
      for (let i = 0; i < n; i++) { sim.x[i] = positions[4 * i]; sim.y[i] = positions[4 * i + 1]; }
      const rewritten = sim.rewind ? null : sim.cull();
      if (rewritten) {
        const one = new Float32Array(4), vel = new Float32Array(2);
        for (const i of rewritten) {
          one[0] = sim.x[i]; one[1] = sim.y[i]; one[2] = sim.m[i]; one[3] = sim.r[i];
          vel[0] = sim.vx[i]; vel[1] = sim.vy[i];
          positions.set(one, 4 * i);
          velocities.set(vel, 2 * i);
          device.queue.writeBuffer(bodyBuf, 16 * i, one);
          device.queue.writeBuffer(velBuf, 8 * i, vel);
          if (sim.snap) { device.queue.writeBuffer(snapBody, 16 * i, one); device.queue.writeBuffer(snapVel, 8 * i, vel); }
        }
      }
      return rewritten;
    },

    destroy(keepDevice = false) {
      for (const b of [bodyBuf, velBuf, accBuf, reactBuf, snapBody, snapVel, startBody, gridBuf, densBuf, tmpBuf, presBuf, params, fparams, coresBuf, ...readBody, ...readVel, ...readReact]) b.destroy();
      if (!keepDevice) device.destroy();
    },
  };
}
