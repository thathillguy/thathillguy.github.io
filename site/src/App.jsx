import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

// Fixed population: fewer on small screens and low-core machines.
function bodyCount() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return small || weak ? 2500 : 6000;
}

export default function App() {
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas bodies={bodyCount()} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
      </main>
    </>
  );
}
