import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

// Fixed population: more where the GPU can carry it, fewer on small screens and low-core machines.
function bodyCount() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  if (small || weak) return 8000;
  return navigator.gpu ? 50000 : 20000;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene') || 'nebulae';
  const swarm = Math.min(20000, Math.max(2, Number(params.get('n')) || 3000));
  const threads = params.has('threads') ? Math.max(0, Math.min(16, Number(params.get('threads')) || 0)) : undefined;
  const gpu = params.get('gpu') !== '0';
  const nebulae = params.get('nebulae') === '1' ? 1 : 2;
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas bodies={bodyCount()} scene={scene} swarm={swarm} threads={threads} gpu={gpu} nebulae={nebulae} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
    </>
  );
}
