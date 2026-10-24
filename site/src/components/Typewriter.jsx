import { useEffect, useState } from 'react';

const PHRASES = ['Problem Solver', 'developer', 'data enthusiast'];
const TICK = 50;   // ms per character
const HOLD = 3000; // ms a finished phrase stays up

// Types each phrase out, holds it, deletes it, moves on. Starts by erasing the
// initial word, a nod to the 2017 original, which opened on "student".
export default function Typewriter({ phrases = PHRASES, initial = 'student' }) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    let current = initial;
    let index = -1;
    let deleting = true;
    let timer;

    const tick = () => {
      let delay = TICK;
      if (deleting) {
        if (current.length > 0) {
          current = current.slice(0, -1);
        } else {
          index = (index + 1) % phrases.length;
          deleting = false;
        }
      } else {
        const target = phrases[index];
        current = target.slice(0, current.length + 1);
        if (current === target) {
          deleting = true;
          delay = HOLD;
        }
      }
      setText(current);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, TICK);
    return () => clearTimeout(timer);
  }, [phrases, initial]);

  return <h2 aria-live="polite">{text}</h2>;
}
