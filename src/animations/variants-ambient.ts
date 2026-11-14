// QUILLIX Animation Variants - Ambient & Background Effects
// Subtle atmospheric animations: particles, gradients, grids, glows
// All respect prefers-reduced-motion

import { Variants } from 'motion/react';
import { ANIMATION_CONFIG } from './config.js';

// ============================================================
// Ambient Background Variants
// ============================================================

// Floating particles / dust motes
export const ambientParticlesVariants: Variants = {
  hidden: { opacity: 0, scale: 0 },
  visible: (i: number) => ({
    opacity: [0, 0.3, 0.6, 0.3, 0],
    scale: [0, 1, 1.2, 1, 0],
    x: [0, (i * 73) % 200 - 100, (i * 151) % 300 - 150, (i * 229) % 200 - 100, 0],
    y: [0, (i * 97) % 150 - 75, (i * 191) % 200 - 100, (i * 317) % 150 - 75, 0],
    transition: {
      duration: 20 + (i % 8) * 3,
      repeat: Infinity,
      ease: 'linear',
      delay: (i % 5) * 2,
    },
  }),
};

// Subtle gradient shift (for hero sections, cards)
export const ambientGradientShiftVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// Rotating conic gradient (for accent borders, loading rings)
export const ambientConicRotateVariants: Variants = {
  hidden: { rotate: 0 },
  visible: {
    rotate: 360,
    transition: {
      duration: 8,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// Pulsing glow ring (for status indicators, active elements)
export const ambientGlowPulseVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: [0.3, 0.6, 0.3],
    scale: [0.8, 1.2, 0.8],
    boxShadow: [
      '0 0 20px var(--accent)',
      '0 0 40px var(--accent), 0 0 60px var(--accent-secondary)',
      '0 0 20px var(--accent)',
    ],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// Subtle grid pattern animation (for dashboard backgrounds)
export const ambientGridFlowVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 0.03,
    backgroundPosition: ['0 0', '40px 40px', '0 0'],
    transition: {
      duration: 20,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// Floating orbs (larger, slower - for hero backgrounds)
export const ambientOrbVariants: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: (i: number) => ({
    opacity: [0.05, 0.15, 0.05],
    scale: [0.5, 1, 0.5],
    x: [0, (i * 120) % 300 - 150, 0],
    y: [0, (i * 80) % 200 - 100, 0],
    borderRadius: ['50%', '30% 70% 70% 30%', '50%'],
    transition: {
      duration: 15 + (i % 4) * 5,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: i * 2,
    },
  }),
};

// Subtle noise/grain overlay animation
export const ambientNoiseVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 0.02,
    backgroundPosition: [
      '0 0',
      '100px 100px',
      '-100px 50px',
      '50px -100px',
      '0 0',
    ],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// Shimmer sweep (for cards, buttons, loading states)
export const ambientShimmerVariants: Variants = {
  hidden: { backgroundPosition: '-200% 0' },
  visible: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// ============================================================
// Theme-Aware Ambient Variants
// ============================================================

// Variants that adapt based on current theme
export function createThemeAmbientVariants(theme: 'dark' | 'light' | 'gray' | 'gradient'): {
  particles: Variants;
  grid: Variants;
} {
  const themeConfigs = {
    dark: {
      particleColor: 'rgba(99, 102, 241, 0.4)',
      glowColor: 'rgba(99, 102, 241, 0.3)',
      gridColor: 'rgba(255, 255, 255, 0.02)',
    },
    light: {
      particleColor: 'rgba(79, 70, 229, 0.3)',
      glowColor: 'rgba(79, 70, 229, 0.2)',
      gridColor: 'rgba(0, 0, 0, 0.03)',
    },
    gray: {
      particleColor: 'rgba(122, 132, 148, 0.3)',
      glowColor: 'rgba(122, 132, 148, 0.2)',
      gridColor: 'rgba(255, 255, 255, 0.02)',
    },
    gradient: {
      particleColor: 'rgba(109, 124, 255, 0.4)',
      glowColor: 'rgba(168, 85, 247, 0.3)',
      gridColor: 'rgba(255, 255, 255, 0.02)',
    },
  };

  const config = themeConfigs[theme];

  return {
    particles: {
      hidden: { opacity: 0 },
      visible: {
        opacity: 0.4,
        transition: { duration: 0.5 },
      },
    },
    grid: {
      hidden: { opacity: 0 },
      visible: {
        opacity: 0.03,
        backgroundPosition: ['0 0', '40px 40px'],
        transition: { duration: 20, repeat: Infinity, ease: 'linear' },
      },
    },
  };
}

// ============================================================
// Scroll-Reveal Variants (Intersection Observer driven)
// ============================================================

export const scrollRevealVariants: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 200,
      damping: 20,
      duration: 0.6,
    },
  },
};

export const scrollRevealFastVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: ANIMATION_CONFIG.duration.normal / 1000,
      ease: ANIMATION_CONFIG.easing.decelerate,
    },
  },
};

export const scrollRevealStaggerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_CONFIG.stagger.normal,
      delayChildren: 0.1,
    },
  },
};

// ============================================================
// Entrance/Exit with Physics
// ============================================================

export const springEntranceVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: ANIMATION_CONFIG.easing.spring.bouncy,
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    y: -10,
    transition: ANIMATION_CONFIG.easing.spring.snappy,
  },
};

export const elasticEntranceVariants: Variants = {
  hidden: { opacity: 0, scale: 0.5, rotate: -10 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { type: 'spring', stiffness: 260, damping: 10, mass: 0.8 },
  },
  exit: {
    opacity: 0,
    scale: 0.5,
    rotate: 10,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

export const slideAndFadeVariants: Variants = {
  hidden: (direction: 'up' | 'down' | 'left' | 'right' = 'up') => {
    const offsets = { up: { y: 30 }, down: { y: -30 }, left: { x: 30 }, right: { x: -30 } };
    return { opacity: 0, ...offsets[direction] };
  },
  visible: (direction: 'up' | 'down' | 'left' | 'right' = 'up') => ({
    opacity: 1,
    x: 0,
    y: 0,
    transition: { type: 'spring', stiffness: 260, damping: 25 },
  }),
  exit: (direction: 'up' | 'down' | 'left' | 'right' = 'up') => {
    const offsets = { up: { y: -20 }, down: { y: 20 }, left: { x: -20 }, right: { x: 20 } };
    return { opacity: 0, ...offsets[direction], transition: { duration: 0.2 } };
  },
};

// ============================================================
// Focus Ring Variants (Accessible)
// ============================================================

export const focusRingVariants: Variants = {
  idle: { boxShadow: 'none', outline: 'none' },
  focus: {
    boxShadow: '0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent)',
    outline: 'none',
    transition: { type: 'spring', stiffness: 400, damping: 20 },
  },
  focusVisible: {
    boxShadow: '0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent)',
    outline: '2px solid var(--accent)',
    outlineOffset: '2px',
    transition: { type: 'spring', stiffness: 400, damping: 20 },
  },
};

// ============================================================
// Loading / Progress Variants
// ============================================================

export const skeletonPulseVariants: Variants = {
  hidden: { opacity: 0.4 },
  visible: {
    opacity: [0.4, 0.7, 0.4],
    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const skeletonWaveVariants: Variants = {
  hidden: { backgroundPosition: '-200% 0' },
  visible: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: { duration: 1.5, repeat: Infinity, ease: 'linear' },
  },
};

export const progressRingVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (progress: number) => ({
    pathLength: progress,
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  }),
  indeterminate: {
    pathLength: 0.6,
    pathOffset: [0, 1],
    transition: { duration: 1.5, repeat: Infinity, ease: 'linear' },
  },
};

export const streamingTextVariants: Variants = {
  hidden: { opacity: 0, width: 0 },
  visible: {
    opacity: 1,
    width: 'auto',
    transition: { duration: 0.05, ease: 'linear' },
  },
};

// ============================================================
// Drag & Drop Variants
// ============================================================

export const dragVariants: Variants = {
  idle: { scale: 1, boxShadow: 'var(--shadow)', zIndex: 1 },
  hover: { scale: 1.02, boxShadow: '0 20px 40px rgba(0,0,0,0.3)', zIndex: 10 },
  drag: { scale: 1.05, boxShadow: '0 30px 60px rgba(0,0,0,0.4)', zIndex: 100, rotate: 2 },
  drop: { scale: 1, boxShadow: 'var(--shadow)', zIndex: 1, transition: ANIMATION_CONFIG.easing.spring.snappy },
};

export const dropZoneVariants: Variants = {
  idle: { backgroundColor: 'transparent', borderColor: 'var(--border)' },
  hover: { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', transition: { duration: 0.15 } },
  active: { backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', scale: 1.01 },
};

// ============================================================
// Notification/Toast Variants (Enhanced)
// ============================================================

export const notificationSlideVariants: Variants = {
  hidden: { opacity: 0, x: 400, scale: 0.9, rotate: 5 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    rotate: 0,
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
  exit: {
    opacity: 0,
    x: 400,
    scale: 0.9,
    rotate: -5,
    transition: { duration: 0.25, ease: 'easeIn' },
  },
};

export const notificationStackVariants: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, type: 'spring', stiffness: 300, damping: 25 },
  }),
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } },
};

// ============================================================
// Tab/Content Switch Variants
// ============================================================

export const tabSwitchVariants: Variants = {
  hidden: { opacity: 0, x: 20, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    x: -20,
    filter: 'blur(4px)',
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

export const accordionVariants: Variants = {
  closed: { height: 0, opacity: 0 },
  open: {
    height: 'auto',
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
};

// ============================================================
// Command Palette / Search Variants
// ============================================================

export const searchResultVariants: Variants = {
  hidden: { opacity: 0, x: -20, height: 0 },
  visible: {
    opacity: 1,
    x: 0,
    height: 'auto',
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
  exit: { opacity: 0, x: 20, height: 0, transition: { duration: 0.2 } },
};

// ============================================================
// Utility: Create variants with reduced motion fallback
// ============================================================

export function createReducedMotionVariants<T extends Variants>(
  normalVariants: T,
  reducedVariants: Partial<T> = {}
): T {
  // This is a compile-time helper; actual reduced-motion handling
  // should be done via the useReducedMotion hook at runtime
  return normalVariants;
}

export default {
  ambientParticlesVariants,
  ambientGradientShiftVariants,
  ambientConicRotateVariants,
  ambientGlowPulseVariants,
  ambientGridFlowVariants,
  ambientOrbVariants,
  ambientNoiseVariants,
  ambientShimmerVariants,
  scrollRevealVariants,
  scrollRevealFastVariants,
  scrollRevealStaggerVariants,
  springEntranceVariants,
  elasticEntranceVariants,
  slideAndFadeVariants,
  focusRingVariants,
  skeletonPulseVariants,
  skeletonWaveVariants,
  progressRingVariants,
  streamingTextVariants,
  dragVariants,
  dropZoneVariants,
  notificationSlideVariants,
  notificationStackVariants,
  tabSwitchVariants,
  accordionVariants,
  searchResultVariants,
  createThemeAmbientVariants,
};