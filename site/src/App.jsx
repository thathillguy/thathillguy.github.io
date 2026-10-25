import { useEffect, useState } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';
import BodyCount from './components/BodyCount.jsx';

const KEY = 'nbody.count';

function defaultCount() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= 1000 && saved <= 20000) return saved;
  } catch { /* storage unavailable */ }
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return small || weak ? 2000 : 6000;
}

export default function App() {
  const [count, setCount] = useState(defaultCount);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, String(count)); } catch { /* ignore */ }
  }, [count]);

  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas bodies={count} onStats={setStats} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
        <BodyCount value={count} onChange={setCount} stats={stats} />
      </main>
    </>
  );
}
