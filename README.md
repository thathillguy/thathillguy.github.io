# thathillguy.github.io

Robert Hill's personal site: a live n-body gravity simulation behind the name card.

Every body attracts every other body (softened Newtonian gravity, velocity Verlet, all pairs),
with a heavy black body pinned at the centre. Click to drop a body into a circular orbit, or
drag to fling one. Bodies that fall into the centre or get thrown out of the system are replaced
from the edge.

- `site/src/sim/nbody.js` is the physics. It has no DOM or React dependencies and is tested with `node --test`.
- `site/src/components/NBodyCanvas.jsx` renders it on a canvas and handles the pointer.

## Develop

    npm install
    npm run dev      # local server with hot reload
    npm test         # physics tests
    npm run build    # production build in dist/

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes it
two ways so that either GitHub Pages mode works:

- the built files are committed to the repo root (`index.html`, `assets/`, `favicon.svg`, `icons/`)
  for the "deploy from a branch" setting, and
- the same build is uploaded as a Pages artifact for the "GitHub Actions" setting.

The source page is `site/index.html`; the root `index.html` is build output. Do not edit it.

The simulation first appeared here in 2017 as an SVG rendered through React state. This is the
canvas rewrite of the same idea, keeping the original palette and layout.
