// NUVRO AI Animation Configuration
// Centralized animation constants and settings

export const ANIMATION_CONFIG = {
  // Durations (ms)
  duration: {
    instant: 0,
    fast: 150,
    normal: 250,
    slow: 400,
    slower: 600,
    slowest: 1000,
  },
  
  // Easing curves
  easing: {
    // Standard Material-style easing
    standard: [0.2, 0.0, 0.38, 0.9] as const,
    // Accelerate (for exits)
    accelerate: [0.4, 0.0, 1, 1] as const,
    // Decelerate (for entrances)
    decelerate: [0.0, 0.0, 0.2, 1] as const,
    // Sharp (for UI elements)
    sharp: [0.4, 0.0, 0.6, 1] as const,
    // Spring configurations
    spring: {
      gentle: { type: 'spring' as const, stiffness: 120, damping: 14 },
      smooth: { type: 'spring' as const, stiffness: 260, damping: 20 },
      snappy: { type: 'spring' as const, stiffness: 400, damping: 25 },
      bouncy: { type: 'spring' as const, stiffness: 500, damping: 20 },
      wobbly: { type: 'spring' as const, stiffness: 600, damping: 15 },
    },
  },
  
  // Stagger delays
  stagger: {
    fast: 0.03,
    normal: 0.06,
    slow: 0.1,
  },
  
  // Reduced motion fallbacks
  reducedMotion: {
    duration: 0.01,
    transition: { duration: 0.01 },
  },
} as const;

// ============================================================
// Transition Presets
// ============================================================

export const transitions = {
  // Quick micro-interactions
  micro: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.standard },
  microSpring: ANIMATION_CONFIG.easing.spring.snappy,
  
  // Standard UI transitions
  standard: { duration: ANIMATION_CONFIG.duration.normal / 1000, ease: ANIMATION_CONFIG.easing.decelerate },
  standardSpring: ANIMATION_CONFIG.easing.spring.smooth,
  
  // Slow, deliberate transitions
  slow: { duration: ANIMATION_CONFIG.duration.slow / 1000, ease: ANIMATION_CONFIG.easing.decelerate },
  slowSpring: ANIMATION_CONFIG.easing.spring.gentle,
  
  // Exits (faster)
  exit: { duration: ANIMATION_CONFIG.duration.fast / 1000, ease: ANIMATION_CONFIG.easing.accelerate },
  exitSpring: { type: 'spring', stiffness: 400, damping: 25 },
  
  // Page transitions
  page: { duration: ANIMATION_CONFIG.duration.slow / 1000, ease: ANIMATION_CONFIG.easing.standard },
  pageSpring: { type: 'spring', stiffness: 200, damping: 20 },
} as const;

// ============================================================
// Animation Keyframes
// ============================================================

export const keyframes = {
  // Bounce in
  bounceIn: [0, 0.6, 0.8, 1, 0.97, 1],
  // Elastic
  elasticIn: [0, 0.5, 1.1, 0.95, 1.02, 1],
  // Shake
  shake: [0, -10, 10, -10, 10, 0],
  // Pulse
  pulse: [1, 1.05, 1],
  // Glow pulse
  glowPulse: ['var(--shadow)', '0 0 30px var(--accent)', 'var(--shadow)'],
} as const;

export default ANIMATION_CONFIG;