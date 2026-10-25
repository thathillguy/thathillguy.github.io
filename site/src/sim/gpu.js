// WebGPU brute-force gravity: every body against every other, tiled through workgroup memory.
// One pass yields both the body-body accelerations and the touching pairs. The CPU keeps the
// authoritative 64-bit state; this only replaces the tree walk. Returns null where WebGPU is absent.

const WG = 256;

const SHADER = /* wgsl */ `
struct Params { n: u32, pairCap: u32, eps2: f32, touchFactor: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> body: array<vec4<f32>>;   // x, y, m, r
@group(0) @binding(2) var<storage, read_write> accel: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> pairCount: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> pairs: array<u32>;

var<workgroup> tile: array<vec4<f32>, ${WG}>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let i = gid.x;
  let n = p.n;
  var me = vec4<f32>(0.0);
  if (i < n) { me = body[i]; }
  var a = vec2<f32>(0.0);
  let tiles = (n + ${WG}u - 1u) / ${WG}u;
  for (var t = 0u; t < tiles; t++) {
    let j0 = t * ${WG}u + lid.x;
    if (j0 < n) { tile[lid.x] = body[j0]; } else { tile[lid.x] = vec4<f32>(0.0); }
    workgroupBarrier();
    if (i < n) {
      let limit = min(${WG}u, n - t * ${WG}u);
      for (var k = 0u; k < limit; k++) {
        let j = t * ${WG}u + k;
        if (j == i) { continue; }
        let o = tile[k];
        let d = o.xy - me.xy;
        let d2 = dot(d, d);
        let q = d2 + p.eps2;
        let inv = inverseSqrt(q);
        a += d * (o.z * inv * inv * inv);
        if (j > i) {
          let reach = p.touchFactor * (me.w + o.w);
          if (d2 < reach * reach) {
            let slot = atomicAdd(&pairCount, 1u);
            if (slot * 2u + 1u < p.pairCap) { pairs[slot * 2u] = i; pairs[slot * 2u + 1u] = j; }
          }
        }
      }
    }
    workgroupBarrier();
  }
  if (i < n) { accel[i] = a; }
}`;

export async function createGpuSolver() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return null;
  const device = await adapter.requestDevice().catch(() => null);
  if (!device) return null;

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let cap = 0, pairCap = 0;
  let bodyBuf, accelBuf, accelRead, countBuf, pairsBuf, pairsRead, countRead, bindGroup;
  let staging = new Float32Array(0);

  const ensure = (n) => {
    if (n <= cap) return;
    cap = Math.ceil(n * 1.5) + 1024;
    pairCap = 16 * cap + 4096;
    for (const b of [bodyBuf, accelBuf, accelRead, countBuf, pairsBuf, pairsRead, countRead]) b?.destroy();
    bodyBuf = device.createBuffer({ size: cap * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    accelBuf = device.createBuffer({ size: cap * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    accelRead = device.createBuffer({ size: cap * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    countBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    countRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    pairsBuf = device.createBuffer({ size: pairCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    pairsRead = device.createBuffer({ size: pairCap * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: bodyBuf } },
        { binding: 2, resource: { buffer: accelBuf } },
        { binding: 3, resource: { buffer: countBuf } },
        { binding: 4, resource: { buffer: pairsBuf } },
      ],
    });
    staging = new Float32Array(cap * 4);
  };

  const zero = new Uint32Array(4);
  let busy = false;

  return {
    kind: 'webgpu',
    /**
     * Adds body-body accelerations into sim.ax/ay and fills sim._touching; resolves when done.
     * Only one call may be in flight at a time.
     */
    async accelerate(sim) {
      if (busy) throw new Error('gpu solver busy');
      busy = true;
      try {
        const n = sim.n;
        ensure(n);
        const { x, y, m, r } = sim;
        for (let i = 0, k = 0; i < n; i++, k += 4) { staging[k] = x[i]; staging[k + 1] = y[i]; staging[k + 2] = m[i]; staging[k + 3] = r[i]; }
        device.queue.writeBuffer(bodyBuf, 0, staging, 0, n * 4);
        const u = new ArrayBuffer(16);
        new Uint32Array(u, 0, 2).set([n, pairCap]);
        new Float32Array(u, 8, 2).set([sim.o.softening * sim.o.softening, sim.o.touchFactor]);
        device.queue.writeBuffer(uniform, 0, u);
        device.queue.writeBuffer(countBuf, 0, zero);

        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(n / WG));
        pass.end();
        enc.copyBufferToBuffer(accelBuf, 0, accelRead, 0, n * 8);
        enc.copyBufferToBuffer(countBuf, 0, countRead, 0, 16);
        device.queue.submit([enc.finish()]);

        await Promise.all([accelRead.mapAsync(GPUMapMode.READ, 0, n * 8), countRead.mapAsync(GPUMapMode.READ)]);
        const acc = new Float32Array(accelRead.getMappedRange(0, n * 8));
        const { ax, ay } = sim;
        for (let i = 0, k = 0; i < n; i++, k += 2) { ax[i] += acc[k]; ay[i] += acc[k + 1]; }
        accelRead.unmap();
        const count = Math.min(new Uint32Array(countRead.getMappedRange())[0], pairCap >> 1);
        countRead.unmap();

        // touching pairs: a second small readback, only when there are any
        sim._touchCount = 0;
        if (count > 0) {
          const bytes = count * 8;
          const enc2 = device.createCommandEncoder();
          enc2.copyBufferToBuffer(pairsBuf, 0, pairsRead, 0, bytes);
          device.queue.submit([enc2.finish()]);
          await pairsRead.mapAsync(GPUMapMode.READ, 0, bytes);
          const pr = new Uint32Array(pairsRead.getMappedRange(0, bytes));
          const t = sim._touching;
          const take = Math.min(count * 2, t.length);
          for (let k = 0; k < take; k++) t[k] = pr[k];
          sim._touchCount = take;
          pairsRead.unmap();
        }
      } finally {
        busy = false;
      }
    },
    destroy() {
      for (const b of [bodyBuf, accelBuf, accelRead, countBuf, pairsBuf, pairsRead, countRead, uniform]) b?.destroy();
      device.destroy();
    },
  };
}
