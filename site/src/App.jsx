import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

// Fixed population: fewer on small screens and low-core machines.
function bodyCount() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return small || weak ? 8000 : 20000;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene') || 'nebulae';
  const swarm = Math.min(20000, Math.max(2, Number(params.get('n')) || 3000));
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas bodies={bodyCount()} scene={scene} swarm={swarm} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
    </>
  );
}
