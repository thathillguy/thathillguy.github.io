import React from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Link from "@mui/material/Link";

import About from "../Components/About.jsx";

export default function IndexContainer() {
  return (
    <Box component="main" sx={{ flexGrow: 1 }}>
      {/* Hero */}
      <Box sx={{ py: 8 }}>
        <Container maxWidth="md">
          <Typography variant="overline" sx={{ color: "grey.500" }}>
            Senior Software Engineer
          </Typography>
          <Typography variant="h3" component="h1" fontWeight={800} gutterBottom sx={{ mt: 1 }}>
            Building performant systems &amp; delightful UX
          </Typography>
          <Typography variant="body1" sx={{ mb: 3, maxWidth: 600 }}>
            Real-time n-body background with color-mapped velocity and glow. No controls—just vibes.
          </Typography>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Button variant="contained" href="#projects">View Projects</Button>
            <Button variant="outlined" href="/resume.pdf" target="_blank" rel="noopener">Resume</Button>
          </Box>
        </Container>
      </Box>

      {/* Projects */}
      <Box id="projects" sx={{ py: 8 }}>
        <Container maxWidth="lg">
          <Typography variant="h4" component="h2" fontWeight={800} gutterBottom>
            Selected Projects
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600}>N-Body Simulation (this page)</Typography>
                  <Typography variant="body2" color="text.secondary">Live background in About.</Typography>
                </CardContent>
                <CardActions>
                  <Link href="#about" underline="hover" sx={{ ml: 1 }}>Jump to About</Link>
                </CardActions>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600}>PBJ — Pipeline Query Builder</Typography>
                  <Typography variant="body2" color="text.secondary">Programmatic query tooling.</Typography>
                </CardContent>
                <CardActions>
                  <Link href="https://github.com/thathillguy" underline="hover" sx={{ ml: 1 }}>GitHub</Link>
                </CardActions>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600}>Forecasting Module</Typography>
                  <Typography variant="body2" color="text.secondary">REST + React + CRM ingestion.</Typography>
                </CardContent>
                <CardActions>
                  <Link href="#" underline="hover" sx={{ ml: 1 }}>Case Study</Link>
                </CardActions>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* About with full-bleed animated background */}
      <About />
    </Box>
  );
}
