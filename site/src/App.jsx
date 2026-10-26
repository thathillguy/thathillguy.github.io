import { useRef } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

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
          <polygon points="0,0 100,0 88,100 12,100" vectorEffect="non-scaling-stroke" />
        </svg>
        <h2>About</h2>
        <p>
          I'm Robert, a software engineer at [company] in [city], where I [what you do, in one
          line]. Before that I [previous thing worth a line]. I like problems that sit between
          data and product, and I like building things that move.
        </p>
        <p>
          The galaxies above are 100,000 stars under gravity, computed on your GPU every frame.
          Some version of this simulation has lived on this page since 2017.
        </p>
        <p className="links">
          <a href="mailto:[email]">Email</a>
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
