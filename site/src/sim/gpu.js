// WebGPU engine: the stars live on the GPU and are integrated there with all-pairs gravity,
// tiled through workgroup memory. The CPU keeps the cores (exact, 64-bit) and reads positions
// back once per frame for drawing and housekeeping. Returns null where WebGPU is absent.
//
// Body layout, shared with the renderer: vec4 (x, y, mass, radius) per star.

const WG = 256;
const MAX_CORES = 4;

const SHADER = /* wgsl */ `
struct Params { n: u32, k: u32, dt: f32, eps2: f32, mutual: f32, gdown: f32, bottom: f32, bounce: f32, depth: f32 }
struct Core { pos: vec2<f32>, m: f32, e2: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> body: array<vec4<f32>>;  // x, y, m, r
@group(0) @binding(2) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> acc: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> cores: array<Core, ${MAX_CORES}>;
@group(0) @binding(5) var<storage, read_write> react: array<vec2<f32>>; // per workgroup, per core: sum m * a_on_core

var<workgroup> tile: array<vec4<f32>, ${WG}>;
var<workgroup> red: array<vec2<f32>, ${WG}>;

// first half-kick with last step's acceleration, then drift
@compute @workgroup_size(${WG})
fn kickDrift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  var v = vel[i] + acc[i] * (0.5 * p.dt);
  var pos = body[i].xy + v * p.dt;
  if (p.gdown > 0.0) {
    // falling: settle into the bank at this star's own resting height (see bankOffset)
    let u = f32((i + 1u) * 2654435761u) / 4294967296.0;
    let fy = p.bottom - (0.3 + p.depth * u * u);
    if (pos.y > fy) { pos.y = fy; v = vec2<f32>(v.x * 0.97, select(v.y, -v.y * p.bounce, v.y > 0.0)); }
  }
  vel[i] = v;
  body[i] = vec4<f32>(pos, body[i].zw);
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
  if (i < n) { acc[i] = a + vec2<f32>(0.0, p.gdown); }
}

@compute @workgroup_size(${WG})
fn kick(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n) { return; }
  vel[i] = vel[i] + acc[i] * (0.5 * p.dt);
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
  ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipelines = {};
  for (const name of ['kickDrift', 'force', 'kick']) {
    pipelines[name] = device.createComputePipeline({ layout, compute: { module, entryPoint: name } });
  }

  const n = sim.n, cap = n;
  const groups = Math.ceil(n / WG);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const bodyBuf = device.createBuffer({ size: cap * 16, usage });
  const velBuf = device.createBuffer({ size: cap * 8, usage });
  const accBuf = device.createBuffer({ size: cap * 8, usage });
  const reactBuf = device.createBuffer({ size: groups * MAX_CORES * 8, usage });
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
    ],
  });

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

  const writeParams = () => {
    new Uint32Array(paramData, 0, 2).set([n, sim.k]);
    new Float32Array(paramData, 8, 7).set([sim.o.dt, sim.o.softening ** 2, 1 - sim.fall, sim.fall * sim.o.fallG, sim.halfH, sim.o.bounce, sim.o.bankDepth]);
    device.queue.writeBuffer(params, 0, paramData);
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
        coreAccel();
        sim.driftCores(sim.o.dt);        // cores half-kick + drift, in step with the stars
        writeParams();
        writeCores();
        const enc = device.createCommandEncoder();
        dispatch(enc, 'kickDrift');
        dispatch(enc, 'force');
        dispatch(enc, 'kick');
        if (s === steps - 1) {
          enc.copyBufferToBuffer(bodyBuf, 0, readBody[flip], 0, n * 16);
          enc.copyBufferToBuffer(velBuf, 0, readVel[flip], 0, n * 8);
          enc.copyBufferToBuffer(reactBuf, 0, readReact[flip], 0, groups * MAX_CORES * 8);
        }
        device.queue.submit([enc.finish()]);
        coreAccel();
        sim.kickCores(h);
        sim.time += sim.o.dt;
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
      const rewritten = sim.cull();
      if (rewritten) {
        const one = new Float32Array(4), vel = new Float32Array(2);
        for (const i of rewritten) {
          one[0] = sim.x[i]; one[1] = sim.y[i]; one[2] = sim.m[i]; one[3] = sim.r[i];
          vel[0] = sim.vx[i]; vel[1] = sim.vy[i];
          positions.set(one, 4 * i);
          velocities.set(vel, 2 * i);
          device.queue.writeBuffer(bodyBuf, 16 * i, one);
          device.queue.writeBuffer(velBuf, 8 * i, vel);
        }
      }
      return rewritten;
    },

    destroy(keepDevice = false) {
      for (const b of [bodyBuf, velBuf, accBuf, reactBuf, params, coresBuf, ...readBody, ...readVel, ...readReact]) b.destroy();
      if (!keepDevice) device.destroy();
    },
  };
}
