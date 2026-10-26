import { useRef } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';
import { HULL_SHAPE, HULL_SHAPES, setHullProfile } from './sim/fluid.js';

// A portrait screen (a phone) gets a tall card, which no ship profile survives: it rides a raft.
setHullProfile(window.innerWidth < 0.8 * window.innerHeight ? 'raft' : 'ship');
const HULL_POINTS = HULL_SHAPE.map(([u, v]) => `${u * 100},${v * 100}`).join(' ');

/** Where the hull's outline crosses height v (0..1): [left u, right u]. */
function hullSpan(v) {
  const xs = [];
  for (let k = 0; k < HULL_SHAPE.length; k++) {
    const [u0, v0] = HULL_SHAPE[k], [u1, v1] = HULL_SHAPE[(k + 1) % HULL_SHAPE.length];
    if ((v0 <= v && v < v1) || (v1 <= v && v < v0)) xs.push(u0 + ((v - v0) / (v1 - v0)) * (u1 - u0));
  }
  return [Math.min(...xs), Math.max(...xs)];
}
// two boot-topping lines low on the hull, inset a little from the outline
const WATERLINES = HULL_SHAPE === HULL_SHAPES.ship ? [0.885, 0.935].map((v) => { const [a, b] = hullSpan(v); return { v: v * 100, a: (a + 0.012) * 100, b: (b - 0.012) * 100 }; }) : [];

// The star count is measured at startup; `?stars=N` pins it and `?gpu=0` forces the CPU path.
const query = new URLSearchParams(window.location.search);
const STARS = Math.max(0, parseInt(query.get('stars') || '0', 10) || 0);
const GPU = query.get('gpu') !== '0';

export default function App() {
  const hero = useRef(null);
  const boat = useRef(null);
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas stars={STARS} gpu={GPU} warpTarget={hero} boatTarget={boat} />
        <div ref={hero} className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
      <section className="about" id="journey">
        <div className="boat-slot">
        <div ref={boat} className="boat">
        <svg className="hull" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={HULL_POINTS} vectorEffect="non-scaling-stroke" />
          {WATERLINES.map(({ v, a, b }) => <line key={v} x1={a} y1={v} x2={b} y2={v} vectorEffect="non-scaling-stroke" />)}
        </svg>
        <h2>My Journey</h2>
        <div className="deck">
          <p>
            I'm Robert, a senior software engineer in Toronto with a decade of experience. I've spent
            most of it on data-heavy products: the analytics people look at, the backends underneath
            them, the integrations that tie systems together and the infrastructure that keeps it all
            shipping, lately while leading small teams.
          </p>
          <p>
            What I love most is a hard problem at the intersection of data, problem solving and
            product, where the work is making something slow fast or something tangled simple.
          </p>
        </div>
        <p className="links">
          <a href="mailto:rhill352@gmail.com">Email</a>
          <a href="/resume.pdf">Resume</a>
          <a href="https://github.com/thathillguy" rel="me noopener">GitHub</a>
          <a href="https://www.linkedin.com/in/robert-hill-470068a8/" rel="me noopener">LinkedIn</a>
        </p>
        </div>
        </div>
      </section>
    </>
  );
}
