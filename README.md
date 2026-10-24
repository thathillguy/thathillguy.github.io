# thathillguy.github.io

Robert Hill's personal site: a live n-body gravity simulation behind the name card.

Every body attracts every other body (softened Newtonian gravity, velocity Verlet, all pairs),
with a heavy black body pinned at the centre. Click to drop a body into a circular orbit, or
drag to fling one. Bodies that fall into the centre or get thrown out of the system are replaced
from the edge.

- `src/sim/nbody.js` is the physics. It has no DOM or React dependencies and is tested with `node --test`.
- `src/components/NBodyCanvas.jsx` renders it on a canvas and handles the pointer.

## Develop

    npm install
    npm run dev      # local server with hot reload
    npm test         # physics tests
    npm run build    # production build in dist/

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes
`dist/` to GitHub Pages through the Pages deployment API. Nothing built is committed to the repo.

The simulation first appeared here in 2017 as an SVG rendered through React state. This is the
canvas rewrite of the same idea, keeping the original palette and layout.
