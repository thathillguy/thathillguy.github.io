import HeaderBar from './components/HeaderBar.jsx';
import NBodyCanvas from './components/NBodyCanvas.jsx';
import Typewriter from './components/Typewriter.jsx';

export default function App() {
  return (
    <>
      <HeaderBar />
      <main className="intro">
        <NBodyCanvas />
        <div className="my-info">
          <h1>Robert Hill</h1>
          <Typewriter />
        </div>
        <p className="hint">Click to add a body &middot; drag to fling one</p>
      </main>
    </>
  );
}
