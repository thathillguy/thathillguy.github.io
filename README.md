# thathillguy.github.io

Robert Hill's personal site: two nebulae of stars colliding, live, behind the name card.

Each nebula is a disc of stars around an unseen core (a dark halo, in effect). The two start on
an eccentric orbit about each other and swing through one another, throwing out tidal arms. Every
star attracts every other under softened Newtonian gravity; the cores are integrated exactly.
Stars are collisionless, as stars are: their drawn size is a symbol, their real radius is
negligible next to their spacing. Press and hold anywhere to put a black hole under the pointer:
it pulls on everything, swallows what crosses its Schwarzschild radius, and bends the view. No
horizon is drawn; the hole shows only through what it does to the field and the name card.

- `site/src/sim/nbody.js` is the reference simulation: setup, the cores, a Barnes-Hut quadtree
  for the star-star forces, housekeeping. No DOM or React; tested with `node --test`, including
  a check of the tree's accelerations against the exact all-pairs result.
- `site/src/sim/gpu.js` runs the stars on the GPU where WebGPU exists: all-pairs gravity in a
  compute shader, integration on the device, positions read back once per frame. Without WebGPU
  it falls back to the CPU tree.
- `site/src/sim/fluid.js` is what the stars become once the page is scrolled to the about
  screen. The world is the whole page, two screens tall: the galaxies fill the first and scroll
  up with it; the canvas is fixed and looks at whichever part the page is scrolled to. When the
  second screen arrives the stars are let go a few at a time and fall as rain (gravity and air
  drag only, nothing to one another) out of the first screen into the second, where each drop
  becomes water as it lands: a weakly compressible particle fluid on a grid (deposit, blur,
  pressure, viscosity, walls) that fills the lower 40% of that screen. A drop lands only where
  the water has room, and only with a small chance per substep, because the galaxy cores rain
  down denser than water and landing a column of them at once burst the pool. The card sits in
  dry dock on the floor of that screen, sheds the rain off its sides, and is launched as a boat
  (boat.js) when the water around it would float it: lifted at a fixed slow rate until a cell of
  water is under the keel, then left to the pressure field, which lifts the keel only as much as
  there is water beneath it. On a phone (portrait) the card would be the whole screen, so there it
  is a compact pier near the top of the second screen instead, held by the page, and the pool fills
  the lower third beneath it with the rain running off the card's sides. The state is snapshotted as
  the fall begins and the same stars stream back to it when you scroll up.
- `site/src/sim/calibrate.js` times a short run at startup and sizes the star count to the device:
  about 100,000 on a laptop GPU, 15,000 on the CPU path, fewer on weaker hardware.
- `site/src/sim/driver.js` keeps the sim real-time within a per-frame budget by adapting the
  timestep between 120 and 30 steps per second.
- `site/src/render/discs.js` draws the stars with WebGL2 instancing and multiplicative blending,
  so where they overlap the colour deepens like ink on paper, then applies the lens pass.
  `site/src/render/warp.js` bends the name card with the same field through an SVG filter.

`?gpu=0` forces the CPU path and `?stars=N` pins the star count. When benchmarking, keep the
browser window in front; macOS slows a background app's threads several-fold.

The "My Journey" card's copy is in `site/src/App.jsx` (the code still calls it the about card).
The resume it links is `site/public/resume.pdf`, served at `/resume.pdf`.

## Develop

    npm install
    npm run dev      # local server with hot reload
    npm test         # physics and driver tests
    npm run build    # production build in dist/
    npm run preview  # serve dist/ at http://localhost:4173 (run from the repo root, where vite.config.js is)

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes it
two ways so that either GitHub Pages mode works: the built files are committed to the repo root
(`index.html`, `assets/`, `favicon.svg`) for the "deploy from a branch" setting, and the same build
is uploaded as a Pages artifact for the "GitHub Actions" setting. The source page is
`site/index.html`; the root `index.html` is build output. Do not edit it.

The simulation first appeared here in 2017 as an SVG rendered through React state.
