/**
 * theme.ts
 * ==============================================================================
 * Central Theme Tokens & Style Constants (Strict Black + Charcoal + Orange)
 * Design Language:
 *   - Background: Pure Black (#000000)
 *   - Surface 1: Dark Charcoal (#1B1D1A) - panels, cards, sidebar, navigation
 *   - Surface 2: Dark Charcoal (#262824) - inputs, nested panels, hover surfaces
 *   - Border: Subtle Divider (#33362F) - 1px borders
 *   - Text: Pale Off-White with faint green tint (#F0FFEA)
 *   - Text Muted: Secondary text/labels (#9CA195)
 *   - Text Disabled: De-emphasized (#5E625A)
 *   - Accent: Vivid Coral-Orange (#FF5F40)
 *   - Accent Hover: (#FF7459)
 *   - Accent Press: (#E5492B)
 *   - Accent Soft: (rgba(255, 95, 64, 0.14))
 *   - On Accent: Dark (#0A0A0A)
 * ==============================================================================
 */

export const THEME = {
  bg: '#000000',
  surface1: '#1B1D1A',
  surface2: '#262824',
  border: '#33362F',
  text: '#F0FFEA',
  textMuted: '#9CA195',
  textDisabled: '#5E625A',
  accent: '#FF5F40',
  accentHover: '#FF7459',
  accentPress: '#E5492B',
  accentSoft: 'rgba(255, 95, 64, 0.14)',
  onAccent: '#0A0A0A',

  // Charts, Graphs & Plots Palette (strictly derived from tokens)
  chart: {
    primary: '#FF5F40',     // Series 1: Vivid Coral-Orange (Solid)
    secondary: '#F0FFEA',   // Series 2: Pale Off-White (Solid/Dashed)
    tertiary: '#9CA195',    // Series 3: Muted Charcoal-Gray (Dotted)
    quaternary: '#FF7459',  // Series 4: Light Coral-Orange (Dashed)
    grid: '#33362F',        // Chart axes & grid dividers
    tooltipBg: '#1B1D1A',   // Tooltip popups
    tooltipBorder: '#33362F',
    tooltipText: '#F0FFEA',
  },

  // Optical HUD, Canvas Reticle & 3D Overlays
  canvas: {
    reticle: '#FF5F40',
    reticleLocked: '#FF5F40',
    reticleSearching: '#9CA195',
    targetBox: '#FF5F40',
    targetTrail: 'rgba(255, 95, 64, 0.35)',
    gridLines: '#33362F',
    hudText: '#F0FFEA',
    hudMuted: '#9CA195',
    crosshair: 'rgba(240, 255, 234, 0.4)',
    boresight: '#FF5F40',
    fieldOfView: '#33362F',
  },

  // Typography Scale (IBM Plex Mono)
  fontMono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

/**
 * Helper to produce standard status pill styling with text badge and icon
 */
export function getStatusStyle(status: string | null | undefined): {
  bg: string;
  text: string;
  border: string;
  icon: string;
  label: string;
} {
  const s = (status || '').toUpperCase();
  if (['PASS', 'OK', 'LOCKED', 'TRACKING', 'OPERATIONAL', 'DETECTED', 'LINK_OK', 'CONNECTED'].includes(s)) {
    return {
      bg: 'bg-[rgba(255,95,64,0.14)]',
      text: 'text-[#FF5F40]',
      border: 'border-[#FF5F40]',
      icon: '✓',
      label: status || 'OK',
    };
  }
  if (['FAIL', 'ERROR', 'LOST', 'DISCONNECTED', 'OUTSIDE FOV', 'BLOCKED', 'LINK_BLOCKED', 'NO_COVERAGE'].includes(s)) {
    return {
      bg: 'bg-[rgba(255,95,64,0.14)]',
      text: 'text-[#FF5F40]',
      border: 'border-[#FF5F40]',
      icon: '✕',
      label: status || 'ERROR',
    };
  }
  if (['WARN', 'WARNING', 'ACQUIRING', 'REACQUIRING', 'SEARCHING', 'PENDING', 'COASTING', 'DEGRADED'].includes(s)) {
    return {
      bg: 'bg-[#262824]',
      text: 'text-[#F0FFEA]',
      border: 'border-[#33362F]',
      icon: '!',
      label: status || 'STANDBY',
    };
  }
  return {
    bg: 'bg-[#262824]',
    text: 'text-[#9CA195]',
    border: 'border-[#33362F]',
    icon: '•',
    label: status || 'IDLE',
  };
}
