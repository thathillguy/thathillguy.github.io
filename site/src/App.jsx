import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

// How many stars: the GPU carries far more than the CPU fallback; small or weak devices get fewer.
const small = Math.min(window.innerWidth, window.innerHeight) < 700;
const weak = (navigator.hardwareConcurrency || 4) <= 4;
const STARS_GPU = small ? 30000 : 100000;
const STARS_CPU = small || weak ? 6000 : 15000;

export default function App() {
  const gpu = new URLSearchParams(window.location.search).get('gpu') !== '0';
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas starsGpu={STARS_GPU} starsCpu={STARS_CPU} gpu={gpu} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
    </>
  );
}
