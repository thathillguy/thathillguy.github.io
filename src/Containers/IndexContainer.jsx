import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid2";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Link from "@mui/material/Link";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import GitHubIcon from "@mui/icons-material/GitHub";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import LaunchIcon from "@mui/icons-material/Launch";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";

// ---------- Utilities ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (min, max) => Math.random() * (max - min) + min;

// ---------- N-Body Simulation ----------
function useAnimationFrame(callback, isRunning) {
  const requestRef = useRef();
  const previousTimeRef = useRef();

  useEffect(() => {
    if (!isRunning) return;

    const animate = (time) => {
      if (previousTimeRef.current !== undefined) {
        const deltaTime = (time - previousTimeRef.current) / 1000; // seconds
        callback(deltaTime);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(requestRef.current);
      previousTimeRef.current = undefined;
    };
  }, [callback, isRunning]);
}

function createParticles(count, width, height) {
  const particles = new Array(count).fill(0).map(() => ({
    x: rand(0.1 * width, 0.9 * width),
    y: rand(0.1 * height, 0.9 * height),
    vx: rand(-20, 20),
    vy: rand(-20, 20),
    mass: rand(0.5, 2.0),
  }));
  return particles;
}

function presetGalaxy(count, width, height) {
  const cx = width / 2, cy = height / 2;
  return new Array(count).fill(0).map((_, i) => {
    const r = rand(20, Math.min(width, height) * 0.45) * Math.sqrt(Math.random());
    const theta = rand(0, Math.PI * 2);
    const speed = Math.sqrt(r) * 2.0; // faux Keplerian falloff for visual feel
    const vx = -Math.sin(theta) * speed;
    const vy = Math.cos(theta) * speed;
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta), vx, vy, mass: rand(0.5, 2.0) };
  });
}

function NBodySim({ height = 480 }) {
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(true);
  const [count, setCount] = useState(250);
  const [G, setG] = useState(40); // gravitational constant (visualized)
  const [softening, setSoftening] = useState(6);
  const [speedMul, setSpeedMul] = useState(1);
  const [trail, setTrail] = useState(true);

  const stateRef = useRef({ particles: [], width: 0, height: 0 });

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(height * dpr);
    stateRef.current.width = canvas.width;
    stateRef.current.height = canvas.height;
  }, [height]);

  const resetParticles = useCallback((preset = "random") => {
    const { width, height } = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = width / (dpr || 1);
    const h = height / (dpr || 1);
    const particles = preset === "galaxy" ? presetGalaxy(count, w, h) : createParticles(count, w, h);
    stateRef.current.particles = particles;
  }, [count]);

  useEffect(() => {
    resize();
    resetParticles("galaxy");
    const onResize = () => {
      resize();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resize, resetParticles]);

  const step = useCallback((dt) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { particles, width, height } = stateRef.current;

    // Trails / background
    if (!trail) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      ctx.fillRect(0, 0, width, height);
    }

    // Physics — naive O(n^2) but fast enough for a few hundred bodies
    const l = particles.length;
    for (let i = 0; i < l; i++) {
      let ax = 0, ay = 0;
      const pi = particles[i];
      for (let j = 0; j < l; j++) {
        if (i === j) continue;
        const pj = particles[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const distSq = dx * dx + dy * dy + softening * softening;
        const inv = 1.0 / Math.sqrt(distSq);
        const force = (G * pj.mass) * inv * inv; // ~ 1/r^2
        ax += force * dx;
        ay += force * dy;
      }
      pi.vx += ax * dt * speedMul;
      pi.vy += ay * dt * speedMul;
    }

    for (let i = 0; i < l; i++) {
      const p = particles[i];
      p.x += p.vx * dt * speedMul;
      p.y += p.vy * dt * speedMul;
      // wrap edges for continuous feel
      const w = width / dpr, h = height / dpr;
      if (p.x < 0) p.x += w; if (p.x > w) p.x -= w;
      if (p.y < 0) p.y += h; if (p.y > h) p.y -= h;
    }

    // Draw
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "white";
    for (let i = 0; i < l; i++) {
      const p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, Math.min(2.5, p.mass)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, [G, softening, speedMul, trail]);

  useAnimationFrame(step, running);

  const onCanvasClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    stateRef.current.particles.push({ x, y, vx: rand(-30, 30), vy: rand(-30, 30), mass: rand(0.5, 3) });
  }, []);

  return (
    <Card variant="outlined" id="n-body">
      <CardContent>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" justifyContent="space-between" gap={2}>
          <Typography variant="h5" fontWeight={700}>Real‑Time N‑Body Simulation</Typography>
          <Stack direction="row" gap={1}>
            <Tooltip title={running ? "Pause" : "Play"}>
              <IconButton color="primary" onClick={() => setRunning(r => !r)}>
                {running ? <PauseRounded/> : <PlayArrowRounded/>}
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset (Galaxy)">
              <IconButton onClick={() => resetParticles("galaxy")}><RestartAltRounded/></IconButton>
            </Tooltip>
            <Tooltip title="Reset (Random)">
              <Button size="small" onClick={() => resetParticles("random")}>Random</Button>
            </Tooltip>
          </Stack>
        </Stack>

        <Box mt={2}>
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            style={{ width: "100%", height, background: "#000", borderRadius: 12, display: "block" }}
          />
        </Box>

        <Stack mt={2} spacing={2}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Typography variant="body2">Bodies: {count}</Typography>
              <Slider value={count} min={50} max={1000} step={10} onChange={(_, v) => setCount(v)} onChangeCommitted={() => resetParticles()} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Typography variant="body2">Gravity (G): {G}</Typography>
              <Slider value={G} min={5} max={120} step={1} onChange={(_, v) => setG(v)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Typography variant="body2">Softening: {softening}</Typography>
              <Slider value={softening} min={1} max={24} step={1} onChange={(_, v) => setSoftening(v)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Typography variant="body2">Speed × {speedMul.toFixed(2)}</Typography>
              <Slider value={speedMul} min={0.25} max={4} step={0.05} onChange={(_, v) => setSpeedMul(v)} />
            </Grid>
          </Grid>
          <Stack direction="row" alignItems="center" gap={1}>
            <Switch checked={trail} onChange={(e) => setTrail(e.target.checked)} />
            <Typography variant="body2">Trails</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">Tip: click on the canvas to spawn a new body with a random velocity.</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------- Main Portfolio ----------
const projects = [
  {
    title: "N‑Body Simulation (this page)",
    desc: "Interactive gravitational simulation with adjustable parameters.",
    chips: ["React", "Canvas", "Physics"],
    cta: [{ label: "Jump to demo", href: "#n-body" }],
  },
  {
    title: "PBJ — Pipeline Query Builder",
    desc: "Programmatic query tool for large pipeline datasets with fast filtering.",
    chips: ["TypeScript", "Prisma", "Node"],
    cta: [{ label: "GitHub", href: "https://github.com/thathillguy" }],
  },
  {
    title: "Forecasting Module",
    desc: "REST + React forecasting UI backed by real‑time CRM ingestion.",
    chips: ["React", "REST", "Postgres"],
    cta: [{ label: "Case study", href: "#case-forecasting" }],
  },
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

export default function Portfolio() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState("home");

  const theme = useMemo(() => createTheme({
    palette: { mode: dark ? "dark" : "light", primary: { main: dark ? "#90caf9" : "#1976d2" } },
    shape: { borderRadius: 14 },
    typography: { fontFamily: "Inter, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif" },
  }), [dark]);

  const handleTab = (_e, v) => setTab(v);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline/>
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ backdropFilter: "saturate(150%) blur(8px)", backgroundColor: (t) => t.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>Robert Hill</Typography>
          <NavTabs value={tab} onChange={handleTab}/>
          <Stack direction="row" gap={1}>
            <Tooltip title="GitHub">
              <IconButton component={Link} href="https://github.com/thathillguy" target="_blank" rel="noreferrer" aria-label="GitHub"><GitHubIcon/></IconButton>
            </Tooltip>
            <Tooltip title="LinkedIn">
              <IconButton component={Link} href="https://www.linkedin.com/in/thathillguy/" target="_blank" rel="noreferrer" aria-label="LinkedIn"><LinkedInIcon/></IconButton>
            </Tooltip>
            <Tooltip title={dark ? "Light mode" : "Dark mode"}>
              <Switch checked={dark} onChange={(e) => setDark(e.target.checked)} />
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ py: { xs: 6, md: 10 } }}>
        <Container maxWidth="lg">
          {/* Hero */}
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="overline" color="text.secondary">Senior Software Engineer</Typography>
              <Typography variant="h3" fontWeight={900} lineHeight={1.2} sx={{ mt: 1 }}>Building performant systems & delightful UX</Typography>
              <Typography variant="body1" sx={{ mt: 2 }}>
                I ship reliable features across the stack—data pipelines, APIs, and front‑ends. Below is a real‑time
                n‑body simulation I wrote from scratch in React + Canvas. Use the controls to poke the universe.
              </Typography>
              <Stack direction="row" gap={1.5} sx={{ mt: 3 }}>
                <Button variant="contained" size="large" href="#projects">View Projects</Button>
                <Button variant="outlined" size="large" component={Link} href="/resume.pdf" target="_blank" rel="noreferrer" endIcon={<LaunchIcon/>}>Resume</Button>
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <NBodySim height={420}/>
            </Grid>
          </Grid>

          {/* Projects */}
          <Box id="projects" sx={{ mt: 8 }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>Selected Projects</Typography>
            <Grid container spacing={3}>
              {projects.map((p) => (
                <Grid key={p.title} size={{ xs: 12, md: 4 }}>
                  <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" fontWeight={700}>{p.title}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{p.desc}</Typography>
                      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
                        {p.chips.map((c) => <Chip size="small" key={c} label={c} />)}
                      </Stack>
                    </CardContent>
                    <CardActions>
                      {p.cta.map((c) => (
                        <Button key={c.label} size="small" component={Link} href={c.href}>{c.label}</Button>
                      ))}
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* About */}
          <Box id="about" sx={{ mt: 8 }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>About</Typography>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="body1">
                I lead projects end‑to‑end—from architecture to shipped product. Recent work includes a REST API + React
                forecasting view backed by CRM integrations, and a high‑signal pipeline query service (PBJ) powering
                analytics against large datasets. I enjoy clean abstractions, fast feedback loops, and useful docs.
              </Typography>
            </Paper>
          </Box>

          {/* Contact */}
          <Box id="contact" sx={{ mt: 8 }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>Get in touch</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField fullWidth label="Your email" placeholder="you@example.com"/>
                    <TextField fullWidth label="Message" placeholder="Let's build something great."/>
                    <Button variant="contained">Send</Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                    (This form is a placeholder. Hook it up to your email or a serverless function.)
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
          </Box>

          <Divider sx={{ my: 6 }} />
          <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" gap={2}>
            <Typography variant="body2" color="text.secondary">© {new Date().getFullYear()} Robert Hill</Typography>
            <Stack direction="row" gap={1}>
              <Button size="small" component={Link} href="https://thathillguy.github.io/">Legacy site</Button>
              <Button size="small" component={Link} href="#n-body">N‑Body Demo</Button>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
}
