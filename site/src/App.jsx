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
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas stars={STARS} gpu={GPU} warpTarget={hero} />
        <div ref={hero} className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
    </>
  );
}
