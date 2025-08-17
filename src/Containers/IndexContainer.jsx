import React from 'react';
import * as d3 from 'd3';

export default class NBodySimulation extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
    }

    render() {
        var origin = [window.innerWidth/2, window.innerHeight/2], 
            particleCount = this.props.particleCount || 80,
            particles = [], 
            blackHole = {
                x: origin[0],
                y: origin[1], 
                mass: this.props.blackHoleStrength || 1200,
                radius: 25
            },
            time = 0;

        var svg = d3.select('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .style('background', 'linear-gradient(135deg, #050510 0%, #0a0a1a 30%, #1a0033 70%, #000000 100%)')
            .append('g');

        // Create gradient definitions
        var defs = svg.append('defs');
        
        // Black hole gradient
        var blackHoleGradient = defs.append('radialGradient')
            .attr('id', 'blackhole-gradient');
        blackHoleGradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', 'rgba(0, 0, 0, 1)');
        blackHoleGradient.append('stop')
            .attr('offset', '30%')
            .attr('stop-color', 'rgba(80, 20, 120, 0.8)');
        blackHoleGradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', 'rgba(0, 0, 0, 0)');

        // Glow filters for particles
        var glowFilter = defs.append('filter')
            .attr('id', 'glow')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%');
        glowFilter.append('feGaussianBlur')
            .attr('stdDeviation', '3')
            .attr('result', 'coloredBlur');
        var feMerge = glowFilter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'coloredBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        var colorScale = d3.scaleSequential(d3.interpolateRainbow);

        function processParticleData(data, duration) {
            // Render trails first (behind particles)
            var trailData = data.flatMap(function(d) {
                return d.trail.map(function(point, i) {
                    return {
                        x: point.x,
                        y: point.y,
                        hue: point.hue,
                        alpha: (i / d.trail.length) * 0.4,
                        size: (i / d.trail.length) * 2 + 0.5,
                        id: d.id + '-trail-' + i
                    };
                });
            });

            var trails = svg.selectAll('.trail').data(trailData, function(d) { return d.id; });
            trails.enter()
                .append('circle')
                .attr('class', 'trail')
                .attr('r', 0)
                .attr('opacity', 0)
                .merge(trails)
                .transition().duration(duration)
                .attr('cx', function(d) { return d.x; })
                .attr('cy', function(d) { return d.y; })
                .attr('r', function(d) { return d.size; })
                .attr('fill', function(d) { return 'hsla(' + d.hue + ', 85%, 65%, ' + d.alpha + ')'; })
                .attr('opacity', 1);
            trails.exit().remove();

            // Render particles
            var particleElements = svg.selectAll('.particle').data(data, function(d) { return d.id; });
            
            var particleGroups = particleElements.enter()
                .append('g')
                .attr('class', 'particle');

            // Add glow circle
            particleGroups.append('circle')
                .attr('class', 'particle-glow')
                .attr('filter', 'url(#glow)');

            // Add core particle
            particleGroups.append('circle')
                .attr('class', 'particle-core');

            // Add inner bright spot
            particleGroups.append('circle')
                .attr('class', 'particle-inner');

            var allParticles = particleGroups.merge(particleElements);
            
            allParticles.transition().duration(duration)
                .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

            allParticles.select('.particle-glow')
                .transition().duration(duration)
                .attr('r', function(d) { return d.glowSize; })
                .attr('fill', function(d) { return 'hsla(' + d.hue + ', 90%, ' + d.brightness + '%, 0.3)'; });

            allParticles.select('.particle-core')
                .transition().duration(duration)
                .attr('r', function(d) { return d.mass; })
                .attr('fill', function(d) { return 'hsl(' + d.hue + ', 95%, ' + Math.min(95, d.brightness + 20) + '%)'; });

            allParticles.select('.particle-inner')
                .transition().duration(duration)
                .attr('r', function(d) { return d.mass * 0.4; })
                .attr('fill', function(d) { return 'hsl(' + d.hue + ', 100%, 95%)'; });

            particleElements.exit().remove();
        }

        function updatePhysics(particles) {
            particles.forEach(function(particle) {
                // Black hole attraction
                var dx = blackHole.x - particle.x;
                var dy = blackHole.y - particle.y;
                var distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 35) {
                    var force = blackHole.mass / (distance * distance);
                    particle.vx += (dx / distance) * force * 0.0001;
                    particle.vy += (dy / distance) * force * 0.0001;
                }

                // Particle-particle interactions
                particles.forEach(function(other) {
                    if (other.id !== particle.id) {
                        var dx2 = other.x - particle.x;
                        var dy2 = other.y - particle.y;
                        var distance2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                        
                        if (distance2 > 8 && distance2 < 120) {
                            var force2 = 0.00002;
                            particle.vx += (dx2 / distance2) * force2;
                            particle.vy += (dy2 / distance2) * force2;
                        }
                    }
                });

                // Update position
                particle.x += particle.vx;
                particle.y += particle.vy;

                // Calculate color based on velocity and position
                var speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
                var distanceFromCenter = Math.sqrt(
                    Math.pow(particle.x - origin[0], 2) + 
                    Math.pow(particle.y - origin[1], 2)
                );
                
                particle.hue = (speed * 800 + distanceFromCenter * 0.3) % 360;
                particle.brightness = Math.min(90, 40 + speed * 2000);
                particle.glowSize = Math.max(3, Math.min(25, speed * 300));

                // Wrap around edges
                if (particle.x < -50) particle.x = window.innerWidth + 50;
                if (particle.x > window.innerWidth + 50) particle.x = -50;
                if (particle.y < -50) particle.y = window.innerHeight + 50;
                if (particle.y > window.innerHeight + 50) particle.y = -50;

                // Update trail
                particle.trail.push({ x: particle.x, y: particle.y, hue: particle.hue });
                if (particle.trail.length > 12) particle.trail.shift();
            });

            return particles;
        }

        function renderBlackHole() {
            // Accretion disk
            svg.append('circle')
                .attr('cx', blackHole.x)
                .attr('cy', blackHole.y)
                .attr('r', blackHole.radius * 4)
                .attr('fill', 'url(#blackhole-gradient)');

            // Event horizon
            svg.append('circle')
                .attr('cx', blackHole.x)
                .attr('cy', blackHole.y)
                .attr('r', blackHole.radius)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(120, 60, 200, 0.7)')
                .attr('stroke-width', 2);

            // Inner glow
            svg.append('circle')
                .attr('cx', blackHole.x)
                .attr('cy', blackHole.y)
                .attr('r', blackHole.radius * 1.2)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(200, 100, 255, 0.3)')
                .attr('stroke-width', 1);
        }

        function initParticles() {
            particles = [];
            for (var i = 0; i < particleCount; i++) {
                var angle = Math.random() * Math.PI * 2;
                var distance = Math.random() * 300 + 150;
                particles.push({
                    id: i,
                    x: blackHole.x + Math.cos(angle) * distance,
                    y: blackHole.y + Math.sin(angle) * distance,
                    vx: (Math.random() - 0.5) * 0.8,
                    vy: (Math.random() - 0.5) * 0.8,
                    mass: Math.random() * 2 + 0.5,
                    hue: Math.random() * 360,
                    brightness: 50 + Math.random() * 50,
                    glowSize: 10,
                    trail: []
                });
            }
            
            renderBlackHole();
            processParticleData(particles, 1000);
            startAnimation();
        }

        function animate() {
            time++;
            var updatedParticles = updatePhysics(particles);
            processParticleData(updatedParticles, 0);
            
            requestAnimationFrame(animate);
        }

        function startAnimation() {
            animate();
        }

        // Initialize simulation
        initParticles();

        return (
            <svg style={{
                position: 'fixed',
                top: 0,
                left: 0,
                height: '100%', 
                width: '100%',
                zIndex: this.props.zIndex || -1
            }} />
        );
    }
}

// About Component
export const About = ({ particleCount = 100, blackHoleStrength = 1200 }) => {
    return (
        <div
            id="about"
            style={{
                position: 'relative',
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                padding: '64px 0',
                backgroundColor: 'transparent',
                overflow: 'hidden'
            }}
        >
            {/* N-Body Background */}
            <NBodySimulation 
                particleCount={particleCount}
                blackHoleStrength={blackHoleStrength}
                zIndex={0}
            />
            
            {/* Content overlay */}
            <div style={{
                position: 'relative',
                zIndex: 1,
                textAlign: 'center',
                maxWidth: '960px',
                margin: '0 auto',
                padding: '0 24px',
                width: '100%'
            }}>
                <div
                    style={{
                        background: 'rgba(0, 0, 0, 0.4)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '12px',
                        padding: '48px',
                        color: 'white'
                    }}
                >
                    <h2
                        style={{
                            fontSize: 'clamp(2rem, 5vw, 3rem)',
                            fontWeight: '800',
                            marginBottom: '32px',
                            background: 'linear-gradient(135deg, #60a5fa 0%, #a855f7 50%, #ec4899 100%)',
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            margin: '0 0 32px 0'
                        }}
                    >
                        About the N-Body Simulation
                    </h2>
                    
                    <p
                        style={{
                            fontSize: '1.25rem',
                            marginBottom: '24px',
                            color: 'rgba(255, 255, 255, 0.9)',
                            lineHeight: 1.8,
                            fontWeight: 400
                        }}
                    >
                        This background features a real-time gravitational n-body simulation with a central black hole. 
                        Each particle is influenced by gravitational forces, creating natural orbital patterns and 
                        complex emergent behaviors.
                    </p>
                    
                    <p
                        style={{
                            fontSize: '1rem',
                            marginBottom: '24px',
                            color: 'rgba(255, 255, 255, 0.8)',
                            lineHeight: 1.7
                        }}
                    >
                        Colors are dynamically mapped to particle velocities and distances from the gravitational center, 
                        creating a beautiful visualization of kinetic energy throughout the system. The simulation includes 
                        particle trails, gravitational effects, and an accretion disk around the black hole.
                    </p>
                    
                    <p
                        style={{
                            fontSize: '0.875rem',
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontStyle: 'italic',
                            margin: '0'
                        }}
                    >
                        Built with D3.js and SVG, leveraging efficient data binding patterns for 
                        smooth real-time particle physics calculations and rendering.
                    </p>
                </div>
            </div>
        </div>
    );
};
