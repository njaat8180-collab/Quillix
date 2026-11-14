import React, { forwardRef } from 'react';
import { motion } from 'motion/react';

interface GlassCardProps {
  intensity?: 1 | 2 | 3 | 4 | 5;
  noise?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  hoverElevate?: boolean;
  style?: React.CSSProperties;
  id?: string;
  'data-testid'?: string;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      intensity = 3,
      noise = false,
      className = '',
      children,
      onClick,
      hoverElevate = true,
      style,
      ...props
    },
    ref
  ) => {
    const isInteractive = typeof onClick === 'function';

    const intensityStyles = {
      1: { opacity: 'var(--glass-opacity-1)', blur: 'var(--glass-blur-xs)', border: 'var(--glass-border-1)', shadow: 'var(--shadow-1)' },
      2: { opacity: 'var(--glass-opacity-2)', blur: 'var(--glass-blur-sm)', border: 'var(--glass-border-2)', shadow: 'var(--shadow-1)' },
      3: { opacity: 'var(--glass-opacity-3)', blur: 'var(--glass-blur-md)', border: 'var(--glass-border-3)', shadow: 'var(--shadow-2)' },
      4: { opacity: 'var(--glass-opacity-4)', blur: 'var(--glass-blur-lg)', border: 'var(--glass-border-4)', shadow: 'var(--shadow-3)' },
      5: { opacity: 'var(--glass-opacity-5)', blur: 'var(--glass-blur-xl)', border: 'var(--glass-border-4)', shadow: 'var(--shadow-4)' },
    }[intensity];

    const glassStyle: React.CSSProperties = {
      background: `rgba(255, 255, 255, ${intensityStyles.opacity})`,
      backdropFilter: `blur(${intensityStyles.blur})`,
      WebkitBackdropFilter: `blur(${intensityStyles.blur})`,
      border: `1px solid ${intensityStyles.border}`,
      borderRadius: 'var(--radius-card)',
      boxShadow: intensityStyles.shadow,
      transition: 'transform var(--duration-normal) var(--ease-out-expo), box-shadow var(--duration-normal) var(--ease-out-expo)',
      ...style,
    };

    return (
      <motion.div
        ref={ref}
        className={`glass-card ${noise ? 'glass-noise' : ''} ${isInteractive ? 'cursor-pointer' : ''} ${className}`}
        style={glassStyle}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => { if (isInteractive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
        whileHover={hoverElevate && !isInteractive ? { y: -2, boxShadow: 'var(--shadow-3)' } : undefined}
        whileTap={isInteractive ? { scale: 0.98 } : undefined}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassCard.displayName = 'GlassCard';

interface GlassPanelProps {
  intensity?: 3 | 4 | 5;
  noise?: boolean;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  id?: string;
  'data-testid'?: string;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ intensity = 4, noise = false, className = '', children, style, ...props }, ref) => {
    const intensityStyles = {
      3: { opacity: 'var(--glass-opacity-3)', blur: 'var(--glass-blur-md)', border: 'var(--glass-border-3)', shadow: 'var(--shadow-2)', radius: 'var(--radius-panel)' },
      4: { opacity: 'var(--glass-opacity-4)', blur: 'var(--glass-blur-lg)', border: 'var(--glass-border-4)', shadow: 'var(--shadow-3)', radius: 'var(--radius-panel)' },
      5: { opacity: 'var(--glass-opacity-5)', blur: 'var(--glass-blur-xl)', border: 'var(--glass-border-4)', shadow: 'var(--shadow-4)', radius: 'var(--radius-modal)' },
    }[intensity];

    const glassStyle: React.CSSProperties = {
      background: `rgba(255, 255, 255, ${intensityStyles.opacity})`,
      backdropFilter: `blur(${intensityStyles.blur})`,
      WebkitBackdropFilter: `blur(${intensityStyles.blur})`,
      border: `1px solid ${intensityStyles.border}`,
      borderRadius: intensityStyles.radius,
      boxShadow: intensityStyles.shadow,
      ...style,
    };

    return (
      <motion.div
        ref={ref}
        className={`glass-panel ${noise ? 'glass-noise' : ''} ${className}`}
        style={glassStyle}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassPanel.displayName = 'GlassPanel';

import { ReactNode } from 'react';

interface GlassButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
  id?: string;
  'data-testid'?: string;
  type?: 'button' | 'submit' | 'reset';
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      icon,
      iconRight,
      loading = false,
      fullWidth = false,
      children,
      className = '',
      disabled,
      style,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const variantStyles = {
      primary: {
        bg: 'var(--accent)',
        color: 'var(--text-on-accent)',
        border: 'var(--accent)',
        hoverBg: 'var(--accent-hover)',
        hoverBorder: 'var(--accent-hover)',
        activeBg: 'var(--accent-active)',
        glow: 'var(--glow-sm)',
      },
      secondary: {
        bg: 'var(--surface)',
        color: 'var(--text)',
        border: 'var(--border)',
        hoverBg: 'var(--surface-hover)',
        hoverBorder: 'var(--border-hover)',
        activeBg: 'var(--surface-active)',
        glow: 'var(--glow-sm)',
      },
      ghost: {
        bg: 'transparent',
        color: 'var(--text)',
        border: 'transparent',
        hoverBg: 'var(--surface)',
        hoverBorder: 'transparent',
        activeBg: 'var(--surface-hover)',
        glow: 'none',
      },
      danger: {
        bg: 'var(--danger)',
        color: 'var(--text-on-accent)',
        border: 'var(--danger)',
        hoverBg: 'var(--danger)',
        hoverBorder: 'var(--danger)',
        activeBg: 'var(--danger)',
        glow: 'var(--glow-danger)',
      },
    }[variant];

    const sizeStyles = {
      sm: { padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)', gap: 'var(--space-1)', iconSize: 12 },
      md: { padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)', gap: 'var(--space-2)', iconSize: 14 },
      lg: { padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-base)', gap: 'var(--space-2)', iconSize: 16 },
    }[size];

    const buttonStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sizeStyles.gap,
      padding: sizeStyles.padding,
      fontFamily: 'var(--font-sans)',
      fontSize: sizeStyles.fontSize,
      fontWeight: 'var(--weight-medium)',
      borderRadius: 'var(--radius-button)',
      border: `1px solid ${variantStyles.border}`,
      background: variantStyles.bg,
      color: variantStyles.color,
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.4 : 1,
      width: fullWidth ? '100%' : 'auto',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      transition: 'background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
      ...style,
    };

    return (
      <motion.button
        ref={ref}
        className={`glass-button ${className}`}
        style={buttonStyle}
        disabled={isDisabled}
        aria-busy={loading}
        aria-disabled={isDisabled}
        whileHover={!isDisabled ? {
          background: variantStyles.hoverBg,
          borderColor: variantStyles.hoverBorder,
          boxShadow: variantStyles.glow,
          transform: 'translateY(-1px)',
        } : undefined}
        whileTap={!isDisabled ? {
          background: variantStyles.activeBg,
          transform: 'scale(0.98)',
        } : undefined}
        {...props}
      >
        {loading ? (
          <svg
            width={sizeStyles.iconSize}
            height={sizeStyles.iconSize}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ animation: 'spin 1s linear infinite' }}
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="31.4 31.4"
            />
          </svg>
        ) : icon ? (
          <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
        ) : null}
        <span>{children}</span>
        {!loading && iconRight ? <span style={{ display: 'flex', flexShrink: 0 }}>{iconRight}</span> : null}
      </motion.button>
    );
  }
);

GlassButton.displayName = 'GlassButton';

interface GlassInputProps {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  iconRight?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  (
    {
      label,
      error,
      hint,
      icon,
      iconRight,
      size = 'md',
      fullWidth = true,
      className = '',
      id,
      style,
      ...props
    },
    ref
  ) => {
    const inputId = id || `glass-input-${React.useId()}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    const sizeStyles = {
      sm: { padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)', iconSize: 12, paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-8)' },
      md: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)', iconSize: 14, paddingLeft: 'var(--space-9)', paddingRight: 'var(--space-9)' },
      lg: { padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', iconSize: 16, paddingLeft: 'var(--space-10)', paddingRight: 'var(--space-10)' },
    }[size];

    const hasIcon = !!icon;
    const hasIconRight = !!iconRight;

    const inputStyle: React.CSSProperties = {
      width: fullWidth ? '100%' : 'auto',
      padding: sizeStyles.padding,
      paddingLeft: hasIcon ? sizeStyles.paddingLeft : sizeStyles.padding,
      paddingRight: hasIconRight ? sizeStyles.paddingRight : sizeStyles.padding,
      fontFamily: 'var(--font-sans)',
      fontSize: sizeStyles.fontSize,
      color: 'var(--text)',
      background: 'var(--input)',
      border: error ? '1px solid var(--danger)' : '1px solid var(--border)',
      borderRadius: 'var(--radius-input)',
      outline: 'none',
      transition: 'border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out)',
      ...style,
    };

    const wrapperStyle: React.CSSProperties = {
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      width: fullWidth ? '100%' : 'auto',
    };

    return (
      <div className={`glass-input-wrapper ${className}`} style={wrapperStyle}>
        {label && (
          <label htmlFor={inputId} style={{ 
            fontSize: 'var(--text-xs)', 
            fontWeight: 'var(--weight-medium)', 
            color: 'var(--text-muted)' 
          }}>
            {label}
          </label>
        )}
        <div style={{ position: 'relative', width: '100%' }}>
          {icon && (
            <span
              style={{
                position: 'absolute',
                left: 'var(--space-3)',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                fontSize: sizeStyles.iconSize,
              }}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            style={inputStyle}
            aria-invalid={!!error}
            aria-describedby={errorId || hintId ? [errorId, hintId].filter(Boolean).join(' ') : undefined}
            {...props}
          />
          {iconRight && (
            <span
              style={{
                position: 'absolute',
                right: 'var(--space-3)',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                fontSize: sizeStyles.iconSize,
              }}
              aria-hidden="true"
            >
              {iconRight}
            </span>
          )}
        </div>
        {error && (
          <p
            id={errorId}
            style={{
              margin: 0,
              fontSize: 'var(--text-xs)',
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
            role="alert"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </p>
        )}
        {hint && !error && (
          <p
            id={hintId}
            style={{
              margin: 0,
              fontSize: 'var(--text-xs)',
              color: 'var(--text-subtle)',
            }}
          >
            {hint}
          </p>
        )}
      </div>
    );
  }
);

GlassInput.displayName = 'GlassInput';