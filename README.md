# thathillguy.github.io

Robert Hill's personal site: a live n-body gravity simulation behind the name card.

Two nebulae, each a disc of small bodies around an unseen core, start on an eccentric orbit
about each other and collide, swinging through one another and throwing out tidal arms. Every
body attracts every other body (softened Newtonian gravity, Barnes-Hut quadtree, velocity Verlet);
the cores are integrated exactly. Bodies thrown out of the system are replaced inside a nebula.
Press and hold anywhere to put a black hole under the pointer: it pulls on everything, swallows
what reaches it, follows a drag, and vanishes on release.

The nebulae are stars: their drawn size is a symbol, their real radius is negligible next to
their spacing, so they never touch and the dynamics are collisionless gravity. The scene at
`/?scene=collide` is planetesimals, whose drawn size is their physical size: contact merges them
with exact mass and momentum, radius follows from mass, hard impacts between comparable masses
throw off fragments that carry only energy the inelastic merge destroyed, a body whose
Schwarzschild radius reaches its own size collapses into a black hole that swallows whole and
lenses the scene. There are no tuning rules beyond those; what you see is what the physics does.

- `site/src/sim/nbody.js` is the physics. No DOM or React dependencies; tested with `node --test`,
  including a check of the tree's accelerations against the exact all-pairs result.
- `site/src/sim/gpu.js` is a WebGPU compute solver: every body against every other, tiled through
  workgroup memory, producing both accelerations and touching pairs in one pass. It is used
  when the browser has WebGPU (then the page starts with 50,000 bodies); the CPU keeps the
  authoritative 64-bit state, so merges and conservation are unchanged. `?gpu=0` disables it.
- `site/src/sim/walk.js` is the tree walk kernel; `walker.js` runs it in worker threads over
  `SharedArrayBuffer` memory, pulling chunks from a shared counter (`pool.js`). That needs
  cross-origin isolation, which GitHub Pages cannot provide in headers, so `public/coi-sw.js`
  is a service worker that adds them; a first visit reloads once. Without isolation the walk
  runs single-threaded, with identical results. `?threads=N` forces a pool size (0 = none).
- `site/src/sim/driver.js` runs the sim in real time within a per-frame budget and adapts the
  timestep (120 down to 30 steps per second) to the measured cost. When benchmarking, keep the
  browser window in front; macOS slows a background app's threads several-fold.
- `site/src/render/discs.js` draws the bodies with WebGL2 instanced quads and a signed-distance
  circle shader (flat fill, black rim), with a 2D canvas fallback.
- `site/src/components/NBodyCanvas.jsx` wires those together and handles the pointer.

## Develop

    npm install
    npm run dev      # local server with hot reload
    npm test         # physics tests
    npm run build    # production build in dist/

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes it
two ways so that either GitHub Pages mode works:

- the built files are committed to the repo root (`index.html`, `assets/`, `favicon.svg`)
  for the "deploy from a branch" setting, and
- the same build is uploaded as a Pages artifact for the "GitHub Actions" setting.

The source page is `site/index.html`; the root `index.html` is build output. Do not edit it.

The simulation first appeared here in 2017 as an SVG rendered through React state. This is the
canvas rewrite of the same idea, keeping the original palette and layout.
