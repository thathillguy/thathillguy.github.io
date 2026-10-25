# thathillguy.github.io

Robert Hill's personal site: two nebulae of stars colliding, live, behind the name card.

Each nebula is a disc of stars around an unseen core (a dark halo, in effect). The two start on
an eccentric orbit about each other and swing through one another, throwing out tidal arms. Every
star attracts every other under softened Newtonian gravity; the cores are integrated exactly.
Stars are collisionless, as stars are: their drawn size is a symbol, their real radius is
negligible next to their spacing. Press and hold anywhere to put a black hole under the pointer:
it pulls on everything, swallows what crosses its Schwarzschild radius, and lenses the scene.

- `site/src/sim/nbody.js` is the reference simulation: setup, the cores, a Barnes-Hut quadtree
  for the star-star forces, housekeeping. No DOM or React; tested with `node --test`, including
  a check of the tree's accelerations against the exact all-pairs result.
- `site/src/sim/gpu.js` runs the stars on the GPU where WebGPU exists: all-pairs gravity in a
  compute shader, integration on the device, positions read back once per frame. The page then
  starts with 100,000 stars; without WebGPU it falls back to the CPU tree with 15,000.
- `site/src/sim/driver.js` keeps the sim real-time within a per-frame budget by adapting the
  timestep between 120 and 30 steps per second.
- `site/src/render/discs.js` draws the stars with WebGL2 instancing and multiplicative blending,
  so where they overlap the colour deepens like ink on paper, then applies the lensing pass.

`?gpu=0` forces the CPU path. When benchmarking, keep the browser window in front; macOS slows a
background app's threads several-fold.

## Develop

    npm install
    npm run dev      # local server with hot reload
    npm test         # physics and driver tests
    npm run build    # production build in dist/

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes it
two ways so that either GitHub Pages mode works: the built files are committed to the repo root
(`index.html`, `assets/`, `favicon.svg`) for the "deploy from a branch" setting, and the same build
is uploaded as a Pages artifact for the "GitHub Actions" setting. The source page is
`site/index.html`; the root `index.html` is build output. Do not edit it.

The simulation first appeared here in 2017 as an SVG rendered through React state.
