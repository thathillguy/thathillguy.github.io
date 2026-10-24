import { useEffect, useState } from 'react';

const PHRASES = ['Problem solver', 'Developer', 'Data enthusiast'];

// Types each phrase with a slightly uneven cadence, holds it, clears it, moves on.
export default function Typewriter({ phrases = PHRASES }) {
  const [text, setText] = useState('');

  useEffect(() => {
    let index = 0;
    let length = 0;
    let deleting = false;
    let timer;

    const tick = () => {
      const target = phrases[index];
      let delay;
      if (deleting) {
        length -= 1;
        delay = 35;
        if (length === 0) {
          deleting = false;
          index = (index + 1) % phrases.length;
          delay = 450;
        }
      } else {
        length += 1;
        delay = 65 + Math.random() * 50;
        if (length === target.length) {
          deleting = true;
          delay = 2400;
        }
      }
      setText(target.slice(0, length));
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [phrases]);

  return (
    <p className="tagline" aria-live="polite">
      <span>{text}</span>
      <span className="caret" aria-hidden="true" />
    </p>
  );
}
