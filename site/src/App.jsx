import { useRef } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';
import { HULL_SHAPE } from './sim/fluid.js';

const HULL_POINTS = HULL_SHAPE.map(([u, v]) => `${u * 100},${v * 100}`).join(' ');

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
      <section className="about" id="about">
        <div className="boat-slot">
        <div ref={boat} className="boat">
        <svg className="hull" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={HULL_POINTS} vectorEffect="non-scaling-stroke" />
        </svg>
        <h2>About</h2>
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
