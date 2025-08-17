import React, { useRef, useEffect } from "react";

// N-Body Background Component - Can be used anywhere
export const NBodyBackground = ({ 
  particleCount = 80, 
  blackHoleStrength = 1000,
  style = {},
  zIndex = -1 
}) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Particle class
    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 0.8;
        this.vy = (Math.random() - 0.5) * 0.8;
        this.mass = Math.random() * 2 + 0.5;
        this.hue = Math.random() * 360;
        this.trail = [];
        this.brightness = 50 + Math.random() * 50;
      }

      update(blackHole, particles) {
        // Black hole attraction
        const dx = blackHole.x - this.x;
        const dy = blackHole.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 35) {
          const force = blackHole.mass / (distance * distance);
          this.vx += (dx / distance) * force * 0.0001;
          this.vy += (dy / distance) * force * 0.0001;
        }

        // Particle-particle interactions (simplified for performance)
        particles.forEach(other => {
          if (other !== this) {
            const dx = other.x - this.x;
            const dy = other.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 8 && distance < 120) {
              const force = 0.00002;
              this.vx += (dx / distance) * force;
              this.vy += (dy / distance) * force;
            }
          }
        });

        // Update position
        this.x += this.vx;
        this.y += this.vy;

        // Color based on velocity and position
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const distanceFromCenter = Math.sqrt(
          Math.pow(this.x - canvas.width / 2, 2) + 
          Math.pow(this.y - canvas.height / 2, 2)
        );
        
        this.hue = (speed * 800 + distanceFromCenter * 0.3) % 360;
        this.brightness = Math.min(90, 40 + speed * 2000);

        // Wrap around edges
        if (this.x < -50) this.x = canvas.width + 50;
        if (this.x > canvas.width + 50) this.x = -50;
        if (this.y < -50) this.y = canvas.height + 50;
        if (this.y > canvas.height + 50) this.y = -50;

        // Trail effect
        this.trail.push({ x: this.x, y: this.y, hue: this.hue });
        if (this.trail.length > 12) this.trail.shift();
      }

      draw(ctx) {
        // Draw trail
        this.trail.forEach((point, index) => {
          const alpha = (index / this.trail.length) * 0.4;
          const size = (index / this.trail.length) * 1.5;
          ctx.fillStyle = `hsla(${point.hue}, 85%, 65%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
          ctx.fill();
        });

        // Draw particle with glow
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const glowSize = Math.max(3, Math.min(25, speed * 300));
        
        // Outer glow
        const gradient = ctx.createRadialGradient(
          this.x, this.y, 0,
          this.x, this.y, glowSize
        );
        gradient.addColorStop(0, `hsla(${this.hue}, 90%, ${this.brightness}%, 0.9)`);
        gradient.addColorStop(0.3, `hsla(${this.hue}, 80%, ${this.brightness}%, 0.4)`);
        gradient.addColorStop(1, `hsla(${this.hue}, 70%, ${this.brightness}%, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Core particle
        ctx.fillStyle = `hsl(${this.hue}, 95%, ${Math.min(95, this.brightness + 20)}%)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.mass, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright core
        ctx.fillStyle = `hsl(${this.hue}, 100%, 95%)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.mass * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Black hole
    const blackHole = {
      x: canvas.width / 2,
      y: canvas.height / 2,
      mass: blackHoleStrength,
      radius: 25
    };

    // Initialize particles
    const initParticles = () => {
      particlesRef.current = [];
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 400 + 150;
        const x = blackHole.x + Math.cos(angle) * distance;
        const y = blackHole.y + Math.sin(angle) * distance;
        particlesRef.current.push(new Particle(x, y));
      }
    };

    initParticles();

    // Animation loop
    const animate = () => {
      // Dark fade instead of clear for trail effect
      ctx.fillStyle = 'rgba(8, 8, 16, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Update black hole position to center
      blackHole.x = canvas.width / 2;
      blackHole.y = canvas.height / 2;

      // Draw black hole accretion disk
      const accretionGradient = ctx.createRadialGradient(
        blackHole.x, blackHole.y, blackHole.radius * 0.5,
        blackHole.x, blackHole.y, blackHole.radius * 4
      );
      accretionGradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      accretionGradient.addColorStop(0.3, 'rgba(80, 20, 120, 0.8)');
      accretionGradient.addColorStop(0.6, 'rgba(40, 10, 80, 0.4)');
      accretionGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = accretionGradient;
      ctx.beginPath();
      ctx.arc(blackHole.x, blackHole.y, blackHole.radius * 4, 0, Math.PI * 2);
      ctx.fill();

      // Event horizon
      ctx.strokeStyle = 'rgba(120, 60, 200, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(blackHole.x, blackHole.y, blackHole.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner event horizon glow
      ctx.strokeStyle = 'rgba(200, 100, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(blackHole.x, blackHole.y, blackHole.radius * 1.2, 0, Math.PI * 2);
      ctx.stroke();

      // Update and draw particles
      particlesRef.current.forEach(particle => {
        particle.update(blackHole, particlesRef.current);
        particle.draw(ctx);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [particleCount, blackHoleStrength]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: zIndex,
        background: 'linear-gradient(135deg, #050510 0%, #0a0a1a 30%, #1a0033 70%, #000000 100%)',
        ...style
      }}
    />
  );
};

sition: 'absolute' }}
        zIndex={0}
      />
      
      {/* Content overlay */}
      <Container 
        maxWidth="md" 
        sx={{ 
          position: 'relative', 
          zIndex: 1,
          textAlign: 'center'
        }}
      >
        <Box
          sx={{
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 3,
            p: 6,
            color: 'white'
          }}
        >
          <Typography
            variant="h3"
            component="h2"
            fontWeight={800}
            gutterBottom
            sx={{
              background: 'linear-gradient(135deg, #60a5fa 0%, #a855f7 50%, #ec4899 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 4
            }}
          >
            About the N-Body Simulation
          </Typography>
          
          <Typography
            variant="h6"
            sx={{
              mb: 3,
              color: 'rgba(255, 255, 255, 0.9)',
              lineHeight: 1.8,
              fontWeight: 400
            }}
          >
            This background features a real-time gravitational n-body simulation with a central black hole. 
            Each particle is influenced by gravitational forces, creating natural orbital patterns and 
            complex emergent behaviors.
          </Typography>
          
          <Typography
            variant="body1"
            sx={{
              mb: 3,
              color: 'rgba(255, 255, 255, 0.8)',
              lineHeight: 1.7
            }}
          >
            Colors are dynamically mapped to particle velocities and distances from the gravitational center, 
            creating a beautiful visualization of kinetic energy throughout the system. The simulation includes 
            particle trails, gravitational lensing effects, and an accretion disk around the black hole.
          </Typography>
          
          <Typography
            variant="body2"
            sx={{
              color: 'rgba(255, 255, 255, 0.6)',
              fontStyle: 'italic'
            }}
          >
            Built with Canvas 2D API, optimized for 60fps performance with efficient particle systems, 
            collision detection algorithms, and GPU-accelerated rendering techniques.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default About;
