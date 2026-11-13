// NUVRO AI Animation System - Main Export
// Comprehensive animation utilities using Framer Motion
// Respects prefers-reduced-motion for accessibility

// Config
export * from './config.js';

// Core variants
export * from './variants-core.js';

// Specialized variants
export * from './variants-ui.js';
export * from './variants-content.js';
export * from './variants-interaction.js';
export * from './variants-page.js';

// Ambient & background effects
export * from './variants-ambient.js';

// Component animations
export * from './component-animations.js';

// Motion props helpers
export * from './motion-props.js';

// Utilities
export { useReducedMotion, getTransition, createStaggerDelay, createSpringTransition } from './variants-core.js';

// Re-export motion/react for convenience
export { motion, AnimatePresence, LayoutGroup, LazyMotion, domAnimation, m } from 'motion/react';

// Default export with everything
import * as config from './config.js';
import * as core from './variants-core.js';
import * as ui from './variants-ui.js';
import * as content from './variants-content.js';
import * as interaction from './variants-interaction.js';
import * as page from './variants-page.js';
import * as ambient from './variants-ambient.js';
import * as components from './component-animations.js';
import * as motionProps from './motion-props.js';

export default {
  config,
  core,
  ui,
  content,
  interaction,
  page,
  ambient,
  components,
  motionProps,
  useReducedMotion: core.useReducedMotion,
  getTransition: core.getTransition,
  createStaggerDelay: core.createStaggerDelay,
  createSpringTransition: core.createSpringTransition,
};