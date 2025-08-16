// src/Components/About.jsx
import React, { useEffect, useRef } from "react";
import { Box, Container, Typography } from "@mui/material";

export default function About() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationId;

    function resizeCanvas() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const numParticles = 120;
    const particles = Array.from({ length: numParticles }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
    }));

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const hue = Math.min(60 + speed * 500, 200);

        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
      });

      animationId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <Box
      id="about"
      sx={{
        position: "relative",
        py: 10,
        overflow: "hidden",
        bgcolor: "black",
        color: "white",
      }}
    >
      {/* Canvas as background */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      />

      {/* Content above the canvas */}
      <Container sx={{ position: "relative", zIndex: 1 }}>
        <Typography variant="h4" component="h2" fontWeight={800} gutterBottom>
          About
        </Typography>
        <Typography variant="body1" sx={{ maxWidth: 700 }}>
          I lead projects end-to-end—from architecture to shipped product.  
          I enjoy clean abstractions, fast feedback loops, and useful docs.
        </Typography>
      </Container>
    </Box>
  );
}
