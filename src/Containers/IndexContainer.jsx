// src/Containers/IndexContainer.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Unstable_Grid2";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Link from "@mui/material/Link";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Paper from "@mui/material/Paper";
import GitHubIcon from "@mui/icons-material/GitHub";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import LaunchIcon from "@mui/icons-material/Launch";

// ---------------- N-Body BACKGROUND (colorful, no UI) ----------------
const rand = (min, max) => Math.random() * (max - min) + min;

function createParticles(count, w, h) {
  const cx = w / 2, cy = h / 2;
  return new Array(count).fill(0).map(() => {
    const r = rand(20, Math.min(w, h) * 0.45) * Math.sqrt(Math.random());
    const theta = rand(0, Math.PI * 2);
    const speed = Math.sqrt(r) * 2.0;
    const vx = -Math.sin(theta) * speed;
    const vy = Math.cos(theta) * speed;
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta), vx, vy, mass: rand(0.5, 2.0) };
  });
}

function NBodyBackground({ target = "page", particleCount = 320 }) {
  // target: "page" (full viewport) or pass a DOM id string to bind to that element.
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const stateRef = useRef({ particles: [], w: 0, h: 0 });
  const [running, setRunning] = useState(true);

  // Resize to viewport or target element
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!canvas || !holder) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = holder.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      stateRef.current.w = w; stateRef.current.h = h;
      const vw = w / dpr, vh = h / dpr;
      stateRef.current.particles = createParticles(particleCount, vw, vh);
    }
  }, [particleCount]);

  useEffect(() => {
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  // Animation
  useEffect(() => {
    if (!running) return;
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000); // cap dt for stability
      last = now;
      renderFrame(dt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const renderFrame = (dt) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { w, h, particles } = stateRef.current;

    // subtle fade for trails
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(0, 0, w, h);

    // gravity (simple n^2)
    const l = particles.length;
    const G = 40, soft = 6, speedMul = 1.0;
    for (let i = 0; i < l; i++) {
      let ax = 0, ay = 0;
      const pi = particles[i];
      for (let j = 0; j < l; j++) {
        if (i === j) continue;
        const pj = particles[j];
        const dx = pj.x - pi.x, dy = pj.y - pi.y;
        const dist2 = dx*dx + dy*dy + soft*soft;
        const inv = 1 / Math.sqrt(dist2);
        const f = (G * pj.mass) * inv * inv;
        ax += f * dx; ay += f * dy;
      }
      pi.vx += ax * dt * speedMul;
      pi.vy += ay * dt * speedMul;
    }
    // integrate + wrap
    const vw = w / dpr, vh = h / dpr;
    for (let i = 0; i < l; i++) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0) p.x += vw; if (p.x > vw) p.x -= vw;
      if (p.y < 0) p.y += vh; if (p.y > vh) p.y -= vh;
    }

    // draw with color by velocity direction; additive blending for glow
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < l; i++) {
      const p = particles[i];
      const hue = (Math.atan2(p.vy, p.vx) * 180 / Math.PI + 360) % 360;
      ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, Math.min(2.5, p.mass)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  // Holder stretches to page or a section; canvas sits behind content
  const style = target === "page"
    ? { position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }
    : { position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" };

  return (
    <>
      {/* For section-only: wrap your section in <Box position="relative"> and render <NBodyBackground target="about" /> inside it.
          Then set holderRef to that container via id="about". */}
      {target === "page" ? (
        <Box ref={holderRef} sx={style}>
          <canvas ref={canvasRef} />
        </Box>
      ) : (
        <Box ref={holderRef} id={target} sx={style}>
          <canvas ref={canvasRef} />
        </Box>
      )}
    </>
  );
}

// ------------------- SITE LAYOUT (no sliders) -------------------
const projects = [
  { title: "N-Body Simulation (this page)", desc: "Interactive gravitational simulation as a live background.", chips: ["React", "Canvas", "Physics"], cta: [{ label: "Jump to projects", href: "#projects" }] },
  { title: "PBJ — Pipeline Query Builder", desc: "Programmatic query tool for large pipeline datasets with fast filtering.", chips: ["TypeScript", "Prisma", "Node"], cta: [{ label: "GitHub", href: "https://github.com/thathillguy" }] },
  { title: "Forecasting Module", desc: "REST + React forecasting UI backed by real-time CRM ingestion.", chips: ["React", "REST", "Postgres"], cta: [{ label: "Case study", href: "#case-forecasting" }] },
];

function NavTabs({ value, onChange }) {
  return (
    <Tabs value={value} onChange={onChange} textColor="inherit" indicatorColor="secondary">
      <Tab label="Home" value="home"/>
      <Tab label="Projects" value="projects"/>
      <Tab label="About" value="about"/>
      <Tab label="Contact" value="contact"/>
    </Tabs>
  );
}

export default function IndexContainer() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState("home");

  const theme = useMemo(() => createTheme({
    palette: { mode: dark ? "dark" : "light", primary: { main: dark ? "#90caf9" : "#1976d2" } },
    shape: { borderRadius: 14 },
    typography: { fontFamily: "Inter, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif" },
  }), [dark]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* full-page colorful background */}
      <NBodyBackground target="page" />

      <AppBar position="sticky" color="transparent" elevation={0}
        sx={{ backdropFilter: "saturate(150%) blur(8px)", backgroundColor: (t) => t.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>Robert Hill</Typography>
          <NavTabs value={tab} onChange={(_, v) => setTab(v)} />
          <Stack direction="row" gap={1}>
            <Tooltip title="GitHub"><IconButton component={Link} href="https://github.com/thathillguy" target="_blank" rel="noreferrer"><GitHubIcon /></IconButton></Tooltip>
            <Tooltip title="LinkedIn"><IconButton component={Link} href="https://www.linkedin.com/in/thathillguy/" target="_blank" rel="noreferrer"><LinkedInIcon /></IconButton></Tooltip>
            <Tooltip title={dark ? "Light mode" : "Dark mode"}><Switch checked={dark} onChange={(e) => setDark(e.target.checked)} /></Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ py: { xs: 6, md: 10 } }}>
        <Container maxWidth="lg">
          {/* Hero (single column; background shows through) */}
          <Grid container spacing={4} alignItems="center">
            <Grid xs={12} md={8}>
              <Typography variant="overline" color="text.secondary">Senior Software Engineer</Typography>
              <Typography variant="h3" fontWeight={900} lineHeight={1.2} sx={{ mt: 1 }}>Building performant systems & delightful UX</Typography>
              <Typography variant="body1" sx={{ mt: 2 }}>
                Real-time n-body background with color-mapped velocity and glow. No controls—just vibes.
              </Typography>
              <Stack direction="row" gap={1.5} sx={{ mt: 3 }}>
                <Button variant="contained" size="large" href="#projects">View Projects</Button>
                <Button variant="outlined" size="large" component={Link} href="/resume.pdf" target="_blank" rel="noreferrer" endIcon={<LaunchIcon/>}>Resume</Button>
              </Stack>
            </Grid>
          </Grid>

          {/* Projects */}
          <Box id="projects" sx={{ mt: 8 }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>Selected Projects</Typography>
            <Grid container spacing={3}>
              {projects.map((p) => (
                <Grid key={p.title} xs={12} md={4}>
                  <Paper variant="outlined" sx={{ p: 3, height: "100%" }}>
                    <Typography variant="h6" fontWeight={700}>{p.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{p.desc}</Typography>
                    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
                      {p.chips.map((c) => <Chip size="small" key={c} label={c} />)}
                    </Stack>
                    <Stack direction="row" gap={1.5} sx={{ mt: 2 }}>
                      {p.cta.map((c) => (<Button key={c.label} size="small" component={Link} href={c.href}>{c.label}</Button>))}
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* About — if you want the background only here:
              Wrap with position="relative" and render <NBodyBackground target="about" /> inside this Box.
              Then remove the full-page instance above. */}
          <Box id="about" sx={{ mt: 8, position: "relative" }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>About</Typography>
            <Paper variant="outlined" sx={{ p: 3, backdropFilter: "blur(2px)", backgroundColor: "rgba(0,0,0,0.15)" }}>
              <Typography variant="body1">
                I lead projects end-to-end—from architecture to shipped product. I enjoy clean abstractions, fast feedback loops, and useful docs.
              </Typography>
            </Paper>
            {/* Example for section-only background:
                <NBodyBackground target="about" /> */}
          </Box>

          <Divider sx={{ my: 6 }} />
          <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" gap={2}>
            <Typography variant="body2" color="text.secondary">© {new Date().getFullYear()} Robert Hill</Typography>
            <Stack direction="row" gap={1}>
              <Button size="small" component={Link} href="https://thathillguy.github.io/">Legacy site</Button>
              <Button size="small" component={Link} href="#projects">Projects</Button>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
              }
        
