import { useRef, useState } from 'react';
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
  const [engine, setEngine] = useState(null); // { bodies, gpu } once the stars exist
  const count = engine ? `${engine.bodies.toLocaleString('en-US')} stars` : 'tens of thousands of stars';
  const where = engine && !engine.gpu ? 'CPU' : 'GPU';
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas stars={STARS} gpu={GPU} warpTarget={hero} boatTarget={boat} onReady={setEngine} />
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
          <div>
            <p>
              I'm Robert, a senior software engineer at AcuityMD in Toronto. I lead a small team
              building forecasting and analytics for medical device sales: live dashboards over
              millions of rows, a CRM integration layer that talks to Salesforce, HubSpot, Dynamics
              and Zoho, and the backend under all of it. Before that I was an architect at
              Rackspace, moving clients onto the cloud and tracking airline carts over IoT, and
              before that I helped build Canada's next search-and-rescue system at MDA in Halifax.
            </p>
          </div>
          <div>
            <p>
              I like problems that sit between data and product, where the work is making a slow
              query fast or a tangled system simple. I studied computer science at UBC in Kelowna.
            </p>
            <p>
              The galaxies above are {count} under gravity, computed on your {where} every frame.
              Scroll back up and press anywhere to drop a black hole in; press here to make a
              splash. Some version of this simulation has lived on this page since 2017.
            </p>
          </div>
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
