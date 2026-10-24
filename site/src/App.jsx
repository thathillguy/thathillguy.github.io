import { useState } from 'react';
import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

export default function App() {
  const [touched, setTouched] = useState(false);
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas onInteract={() => setTouched(true)} />
        <div className="hero">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
        <p className={touched ? 'hint hint-hidden' : 'hint'}>
          Click to add a body &middot; pull back and release to fling one
        </p>
      </main>
    </>
  );
}
