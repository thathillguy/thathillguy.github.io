# thathillguy.github.io

Robert Hill's personal site: a live n-body gravity simulation behind the name card.

Two nebulae, each a disc of small bodies around an unseen core, start on an eccentric orbit
about each other and collide, swinging through one another and throwing out tidal arms. Every
body attracts every other body (softened Newtonian gravity, Barnes-Hut quadtree, velocity Verlet);
the cores are integrated exactly. Bodies thrown out of the system are replaced inside a nebula.
The slider sets the population, up to 20,000 bodies.

- `site/src/sim/nbody.js` is the physics. No DOM or React dependencies; tested with `node --test`,
  including a check of the tree's accelerations against the exact all-pairs result.
- `site/src/sim/driver.js` runs it in real time within a per-frame budget and adapts the timestep
  (120 down to 30 steps per second) to the measured cost. It runs on the main thread: bodies can
  only move as often as the physics steps, so a worker would not make the picture smoother.
  When benchmarking, keep the browser window in front; macOS slows a background app's threads
  several-fold, which is easy to mistake for a slow algorithm.
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
