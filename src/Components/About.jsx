import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

const rand = (a,b)=>Math.random()*(b-a)+a;

export default function About() {
  const sectionRef = useRef(null);
  const canvasRef  = useRef(null);
  const stateRef   = useRef({ w:0, h:0, parts:[] });

  useEffect(() => {
    const section = sectionRef.current;
    const canvas  = canvasRef.current;
    const ctx     = canvas.getContext("2d");

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = section.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        stateRef.current.w = w; stateRef.current.h = h;

        // init particles (CSS pixels)
        const vw = w / dpr, vh = h / dpr, cx = vw/2, cy = vh/2;
        stateRef.current.parts = Array.from({length: 300}, () => {
          const r = rand(20, Math.min(vw,vh)*0.45) * Math.sqrt(Math.random());
          const th = rand(0, Math.PI*2);
          const sp = Math.sqrt(r) * 2.0;
          return {
            x: cx + r*Math.cos(th),
            y: cy + r*Math.sin(th),
            vx: -Math.sin(th)*sp,
            vy:  Math.cos(th)*sp,
            m: rand(0.5, 2.2)
          };
        });
      }
    };

    // resize on load + whenever section changes
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(section);
    window.addEventListener("resize", fit);

    let last = performance.now(), raf;
    const step = (now) => {
      const dt = Math.min(0.033, (now-last)/1000); last = now;
      const dpr = window.devicePixelRatio || 1;
      const { w, h, parts } = stateRef.current;

      // trails
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0,0,w,h);

      // gravity
      const G=40, soft=6;
      for (let i=0;i<parts.length;i++){
        let ax=0, ay=0; const pi=parts[i];
        for (let j=0;j<parts.length;j++){
          if(i===j) continue;
          const pj=parts[j], dx=pj.x-pi.x, dy=pj.y-pi.y;
          const d2=dx*dx+dy*dy+soft*soft, inv=1/Math.sqrt(d2), f=(G*pj.m)*inv*inv;
          ax+=f*dx; ay+=f*dy;
        }
        pi.vx+=ax*dt; pi.vy+=ay*dt;
      }

      // integrate + wrap in CSS pixels
      const vw=w/dpr, vh=h/dpr;
      for (let p of parts){
        p.x+=p.vx*dt; p.y+=p.vy*dt;
        if(p.x<0) p.x+=vw; if(p.x>vw) p.x-=vw;
        if(p.y<0) p.y+=vh; if(p.y>vh) p.y-=vh;
      }

      // draw
      ctx.save(); ctx.scale(dpr,dpr); ctx.globalCompositeOperation="lighter";
      for (let p of parts){
        const hue=(Math.atan2(p.vy,p.vx)*180/Math.PI+360)%360;
        ctx.fillStyle=`hsla(${hue},100%,70%,0.9)`;
        ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.6,Math.min(2.5,p.m)),0,Math.PI*2); ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);

  return (
    <Box
      id="about"
      ref={sectionRef}
      sx={{
        position: "relative",
        mt: 8,
        overflow: "hidden",
        borderRadius: 2,
        minHeight: { xs: "60vh", md: "70vh" },   // << give the section real height
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* background canvas fills section */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 0, pointerEvents: "none" }}
      />
      {/* foreground content */}
      <Container sx={{ position: "relative", zIndex: 1 }}>
        <Typography variant="h4" fontWeight={800} gutterBottom>About</Typography>
        <Typography variant="body1" sx={{ maxWidth: 800 }}>
          I lead projects end-to-end—from architecture to shipped product. I enjoy clean abstractions,
          fast feedback loops, and useful docs.
        </Typography>
      </Container>
    </Box>
  );
}
