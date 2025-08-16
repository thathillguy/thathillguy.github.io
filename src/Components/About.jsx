import React, { useEffect, useRef } from "react";

const About = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const numBodies = 200;
    const bodies = [];

    for (let i = 0; i < numBodies; i++) {
      bodies.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        mass: Math.random() * 2 + 1,
      });
    }

    function draw() {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < numBodies; i++) {
        let b = bodies[i];

        // color mapped by velocity magnitude
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const hue = (speed * 100) % 360;

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.mass, 0, 2 * Math.PI);
        ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `hsl(${hue}, 80%, 60%)`;
        ctx.fill();

        b.x += b.vx;
        b.y += b.vy;

        if (b.x < 0 || b.x > canvas.width) b.vx *= -1;
        if (b.y < 0 || b.y > canvas.height) b.vy *= -1;
      }

      requestAnimationFrame(draw);
    }

    draw();

    const handleResize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <section
      id="about"
      className="relative w-full h-screen flex items-center justify-center overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      <div className="relative z-10 bg-black/60 rounded-xl p-6 max-w-2xl text-center">
        <h2 className="text-3xl font-bold mb-4">About</h2>
        <p className="text-lg leading-relaxed">
          I lead projects end-to-end—from architecture to shipped product. I
          enjoy clean abstractions, fast feedback loops, and useful docs.
        </p>
      </div>
    </section>
  );
};

export default About;
