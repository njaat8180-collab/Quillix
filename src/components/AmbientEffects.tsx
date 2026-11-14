// QUILLIX Ambient Effect Components
// Drop-in components for atmospheric animations
// All respect prefers-reduced-motion and the user's animation level
// (Settings → Appearance → Motion).

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ambientParticlesVariants,
  ambientOrbVariants,
  ambientGradientShiftVariants,
  ambientConicRotateVariants,
  ambientGlowPulseVariants,
  ambientGridFlowVariants,
  ambientNoiseVariants,
  ambientShimmerVariants,
  skeletonPulseVariants,
  skeletonWaveVariants,
  springEntranceVariants,
  fadeVariants,
  slideUpVariants,
} from '../animations/index.js';
import { useAnimationLevel } from '../animations/preferences.js';
import type { QuillixAnimationLevel } from '../shared/types.js';

// ============================================================
// Animation level integration
// ============================================================

interface AmbientMotionState {
  /** OS-level prefers-reduced-motion. */
  osReduced: boolean;
  /** User-selected animation level. */
  level: QuillixAnimationLevel;
  /** Looping ambient layers (orbits, particles, grain flow) only run at full. */
  ambientLoops: boolean;
  /** True when every entrance should collapse to a plain fade. */
  fadeOnly: boolean;
}

export function useAmbientMotion(): AmbientMotionState {
  const osReduced = useReducedMotion() === true;
  const { level } = useAnimationLevel();
  return {
    osReduced,
    level,
    ambientLoops: level === 'full' && !osReduced,
    fadeOnly: level !== 'full' || osReduced,
  };
}


// ============================================================
// Ambient Particles - Floating dust motes
// ============================================================

interface AmbientParticlesProps {
  count?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const AmbientParticles: React.FC<AmbientParticlesProps> = ({
  count = 15,
  className = '',
  style,
}) => {
  const { ambientLoops } = useAmbientMotion();

  const particles = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);

  if (!ambientLoops) return null;

  return (
    <motion.div
      className={`q-ambient-particles absolute inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ ...style, zIndex: 0 }}
      aria-hidden="true"
    >
      {particles.map((i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            width: 2 + (i % 3),
            height: 2 + (i % 3),
            borderRadius: '50%',
            background: 'var(--accent)',
            opacity: 0,
            left: `${10 + (i * 73) % 80}%`,
            top: `${10 + (i * 97) % 80}%`,
            filter: 'blur(0.5px)',
          }}
          variants={ambientParticlesVariants}
          initial="hidden"
          animate="visible"
          custom={i}
        />
      ))}
    </motion.div>
  );
};

// ============================================================
// Ambient Orbs - Large floating gradient orbs
// ============================================================

interface AmbientOrbsProps {
  count?: number;
  className?: string;
  style?: React.CSSProperties;
  theme?: 'dark' | 'light' | 'gray' | 'gradient';
}

export const AmbientOrbs: React.FC<AmbientOrbsProps> = ({
  count = 3,
  className = '',
  style,
  theme = 'dark',
}) => {
  const { ambientLoops } = useAmbientMotion();

  const orbs = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);

  const orbGradients = useMemo(() => {
    const themes = {
      dark: [
        'radial-gradient(ellipse at center, rgba(99,102,241,0.15) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(139,92,246,0.12) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(6,182,212,0.1) 0%, transparent 70%)',
      ],
      light: [
        'radial-gradient(ellipse at center, rgba(79,70,229,0.1) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(124,58,237,0.08) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(8,145,178,0.08) 0%, transparent 70%)',
      ],
      gray: [
        'radial-gradient(ellipse at center, rgba(122,132,148,0.1) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(154,164,178,0.08) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(100,116,139,0.08) 0%, transparent 70%)',
      ],
      gradient: [
        'radial-gradient(ellipse at center, rgba(109,124,255,0.15) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(168,85,247,0.12) 0%, transparent 70%)',
        'radial-gradient(ellipse at center, rgba(236,72,153,0.1) 0%, transparent 70%)',
      ],
    };
    return themes[theme];
  }, [theme]);

  if (!ambientLoops) return null;

  return (
    <motion.div
      className={`q-ambient-orbs absolute inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ ...style, zIndex: 0 }}
      aria-hidden="true"
    >
      {orbs.map((i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            width: 300 + (i % 2) * 200,
            height: 300 + (i % 2) * 200,
            borderRadius: '50%',
            background: orbGradients[i % orbGradients.length],
            filter: 'blur(80px)',
            opacity: 0,
            pointerEvents: 'none',
          }}
          variants={ambientOrbVariants}
          initial="hidden"
          animate="visible"
          custom={i}
        />
      ))}
    </motion.div>
  );
};

// ============================================================
// Ambient Grid - Subtle animated grid pattern
// ============================================================

interface AmbientGridProps {
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  color?: string;
}

export const AmbientGrid: React.FC<AmbientGridProps> = ({
  className = '',
  style,
  size = 40,
  color = 'var(--border)',
}) => {
  const { ambientLoops } = useAmbientMotion();

  if (!ambientLoops) return null;

  return (
    <motion.div
      className={`q-ambient-grid absolute inset-0 pointer-events-none ${className}`}
      style={{
        ...style,
        zIndex: 0,
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        opacity: 0.03,
      }}
      variants={ambientGridFlowVariants}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
};

// ============================================================
// Ambient Noise - Subtle film grain texture
// ============================================================

interface AmbientNoiseProps {
  className?: string;
  style?: React.CSSProperties;
  opacity?: number;
}

export const AmbientNoise: React.FC<AmbientNoiseProps> = ({
  className = '',
  style,
  opacity = 0.02,
}) => {
  const { ambientLoops } = useAmbientMotion();

  // Generate a noise pattern as data URI
  const noiseDataUri = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const imageData = ctx.createImageData(256, 256);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.random() * 255;
      data[i] = val;     // R
      data[i + 1] = val; // G
      data[i + 2] = val; // B
      data[i + 3] = 255; // A
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }, []);

  if (!ambientLoops) return null;

  return (
    <motion.div
      className={`q-ambient-noise absolute inset-0 pointer-events-none ${className}`}
      style={{
        ...style,
        zIndex: 1,
        backgroundImage: `url(${noiseDataUri})`,
        backgroundSize: '256px 256px',
        opacity,
      }}
      variants={ambientNoiseVariants}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
};

// ============================================================
// Gradient Mesh - Animated gradient background
// ============================================================

interface GradientMeshProps {
  className?: string;
  style?: React.CSSProperties;
  colors?: string[];
}

export const GradientMesh: React.FC<GradientMeshProps> = ({
  className = '',
  style,
  colors = ['var(--accent)', 'var(--accent-secondary)', 'var(--accent)'],
}) => {
  const { ambientLoops } = useAmbientMotion();

  const gradientStyle = useMemo(() => ({
    background: `linear-gradient(135deg, ${colors.join(', ')})`,
    backgroundSize: '400% 400%',
  }), [colors]);

  if (!ambientLoops) return null;

  return (
    <motion.div
      className={`q-gradient-mesh absolute inset-0 pointer-events-none ${className}`}
      style={{ ...style, zIndex: 0, opacity: 0.12, ...gradientStyle }}
      variants={ambientGradientShiftVariants}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
};

// ============================================================
// Glow Pulse - Pulsing ring for status/active indicators
// ============================================================

interface GlowPulseProps {
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  color?: string;
  intensity?: number;
}

export const GlowPulse: React.FC<GlowPulseProps> = ({
  className = '',
  style,
  size = 40,
  color = 'var(--accent)',
  intensity = 1,
}) => {
  const { fadeOnly } = useAmbientMotion();

  if (fadeOnly) {
    return (
      <div
        className={className}
        style={{
          ...style,
          width: size,
          height: size,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          opacity: 0.3 * intensity,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <motion.div
      className={className}
      style={{
        ...style,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      }}
      variants={ambientGlowPulseVariants}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
};

// ============================================================
// Shimmer Effect - For cards, buttons, skeletons
// ============================================================

interface ShimmerProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  active?: boolean;
}

export const Shimmer: React.FC<ShimmerProps> = ({
  className = '',
  style,
  children,
  active = true,
}) => {
  const { ambientLoops } = useAmbientMotion();

  if (!active || !ambientLoops) {
    return children ? <div className={className} style={style}>{children}</div> : null;
  }

  return (
    <motion.div
      className={`q-shimmer relative overflow-hidden ${className}`}
      style={{ ...style }}
      variants={ambientShimmerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)', backgroundSize: '200% 100%' }} />
      {children}
    </motion.div>
  );
};

// ============================================================
// Skeleton Loader - Animated placeholder
// ============================================================

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  variant?: 'pulse' | 'wave';
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  style,
  variant = 'pulse',
  width = '100%',
  height = '1rem',
  borderRadius = '0.5rem',
}) => {
  const { fadeOnly } = useAmbientMotion();

  const baseStyle = {
    width,
    height,
    borderRadius,
    backgroundColor: 'var(--surface-secondary)',
    ...style,
  };

  if (fadeOnly) {
    return <div className={className} style={baseStyle} aria-hidden="true" />;
  }

  const variants = variant === 'wave' ? skeletonWaveVariants : skeletonPulseVariants;

  return (
    <motion.div
      className={`q-skeleton ${className}`}
      style={baseStyle}
      variants={variants}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
};

// ============================================================
// Skeleton Group - Multiple skeletons with stagger
// ============================================================

interface SkeletonGroupProps {
  className?: string;
  style?: React.CSSProperties;
  rows?: number;
  variant?: 'pulse' | 'wave';
  rowHeight?: string;
  rowGap?: string;
}

export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  className = '',
  style,
  rows = 5,
  variant = 'pulse',
  rowHeight = '1rem',
  rowGap = '0.75rem',
}) => {
  const { fadeOnly } = useAmbientMotion();

  const skeletons = Array.from({ length: rows }, (_, i) => i);

  return (
    <motion.div
      className={`q-skeleton-group flex flex-col gap-[${rowGap}] ${className}`}
      style={style}
      variants={fadeOnly ? fadeVariants : staggerContainerVariants}
      initial="hidden"
      animate="visible"
    >
      {skeletons.map((i) => (
        <Skeleton
          key={i}
          variant={variant}
          height={rowHeight}
          width={`${60 + Math.random() * 40}%`}
        />
      ))}
    </motion.div>
  );
};

// ============================================================
// Scroll Reveal - Intersection Observer wrapper
// ============================================================

interface ScrollRevealProps {
  children: React.ReactElement;
  className?: string;
  style?: React.CSSProperties;
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  delay?: number;
}

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  className = '',
  style,
  threshold = 0.1,
  rootMargin = '0px 0px -50px 0px',
  once = true,
  direction = 'up',
  delay = 0,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { fadeOnly, level } = useAmbientMotion();

  useEffect(() => {
    if (fadeOnly) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once && ref.current) {
            observer.unobserve(ref.current);
          }
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin, once, fadeOnly]);

  const variants = fadeOnly
    ? fadeVariants
    : {
        hidden: { opacity: 0, ...(direction === 'up' ? { y: 40 } : direction === 'down' ? { y: -40 } : direction === 'left' ? { x: 40 } : { x: -40 }), scale: 0.95 },
        visible: {
          opacity: 1,
          x: 0,
          y: 0,
          scale: 1,
          transition: { type: 'spring' as const, stiffness: 200, damping: 20, delay: level === 'minimal' ? 0 : delay },
        },
      } as const;

  return (
    <motion.div
      ref={ref}
      className={`q-scroll-reveal ${className}`}
      style={style}
      variants={variants}
      initial="hidden"
      animate={isVisible ? 'visible' : 'hidden'}
    >
      {React.cloneElement(children as React.ReactElement<any>, { className: `${(children.props as any).className || ''}`.trim() })}
    </motion.div>
  );
};

// ============================================================
// Staggered Children - Wrapper for stagger animations
// ============================================================

interface StaggerChildrenProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  staggerDelay?: number;
  delayChildren?: number;
  direction?: 'normal' | 'reverse';
}

export const StaggerChildren: React.FC<StaggerChildrenProps> = ({
  children,
  className = '',
  style,
  staggerDelay = 0.06,
  delayChildren = 0.1,
  direction = 'normal',
}) => {
  const { fadeOnly } = useAmbientMotion();

  return (
    <motion.div
      className={`q-stagger-children ${className}`}
      style={style}
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: fadeOnly ? 0 : staggerDelay,
            delayChildren: fadeOnly ? 0 : delayChildren,
            staggerDirection: direction === 'reverse' ? -1 : 1,
          },
        },
      }}
      initial="hidden"
      animate="visible"
    >
      {React.Children.map(children, (child, index) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              variants: fadeOnly ? fadeVariants : slideUpVariants,
              initial: 'hidden',
              animate: 'visible',
            } as any)
          : child
      )}
    </motion.div>
  );
};

// ============================================================
// Floating Action - Floating button with ambient glow
// ============================================================

interface FloatingActionProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  'aria-label'?: string;
}

export const FloatingAction: React.FC<FloatingActionProps> = ({
  children,
  className = '',
  style,
  onClick,
  'aria-label': ariaLabel,
}) => {
  const { level, osReduced } = useAmbientMotion();
  const interactive = level === 'full' && !osReduced;

  return (
    <motion.button
      className={`q-floating-action flex items-center justify-center rounded-full shadow-[var(--shadow)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] ${className}`}
      style={{
        width: 56,
        height: 56,
        ...style,
      }}
      onClick={onClick}
      aria-label={ariaLabel}
      whileHover={interactive ? { scale: 1.1, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' } : undefined}
      whileTap={interactive ? { scale: 0.95 } : undefined}
      animate={interactive ? { boxShadow: ['0 8px 30px rgba(0,0,0,0.3)', '0 12px 40px rgba(99,102,241,0.3)', '0 8px 30px rgba(0,0,0,0.3)'], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } } : undefined}
    >
      {children}
    </motion.button>
  );
};

// ============================================================
// Page Transition Wrapper
// ============================================================

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  className = '',
  style,
}) => {
  const { fadeOnly } = useAmbientMotion();

  return (
    <motion.div
      className={`q-page-transition ${className}`}
      style={style}
      initial={fadeOnly ? { opacity: 0 } : { opacity: 0, x: 20, scale: 0.98 }}
      animate={fadeOnly ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 200, damping: 20 } }}
      exit={fadeOnly ? { opacity: 0 } : { opacity: 0, x: -20, scale: 0.98, transition: { duration: 0.25 } }}
    >
      {children}
    </motion.div>
  );
};

// Need to import staggerContainerVariants for SkeletonGroup
import { staggerContainerVariants } from '../animations/index.js';