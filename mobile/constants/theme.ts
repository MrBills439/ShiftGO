import { shiftGoTokens } from '../../design-system/tokens';

const { color, radius } = shiftGoTokens;

/**
 * Flat palette used by the screen StyleSheets. Every screen previously declared
 * its own local `const D = { … }`; this is the single source of truth. Both the
 * `eDark/eMid/eLight` and `emeraldDark/emeraldLight` names are kept because
 * different screens reference each.
 */
export const D = {
  bg: '#F4F6F5',
  emerald: '#005F56',
  eDark: '#002E28',
  eMid: '#004A42',
  eLight: '#0A7060',
  emeraldDark: '#003D35',
  emeraldLight: '#0A7060',
  mint: '#52D6B5',
  mintBg: 'rgba(82,214,181,0.13)',
  mintBorder: 'rgba(82,214,181,0.28)',
  white: '#FFFFFF',
  text: '#0D1514',
  muted: '#607370',
  light: '#96AEAB',
  border: '#E2EDEB',

  // Status
  error: '#EF4444',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',
  success: '#10B981',
  successBg: '#ECFDF5',
  successBorder: '#A7F3D0',
  successText: '#065F46',
  warning: '#F59E0B',
  amber: '#F59E0B',

  // Inputs
  inputBg: '#F8FAFA',
  inputBorder: '#DDE8E6',
  inputFocus: '#005F56',

  // Per-screen accents (badges, pills, list states)
  confirmedBg: 'rgba(22,163,74,0.11)',
  confirmedTxt: '#16A34A',
  activeBg: 'rgba(0,95,86,0.11)',
  activeTxt: '#005F56',
  completedBg: 'rgba(96,115,112,0.11)',
  completedTxt: '#607370',
  activeTabBg: 'rgba(0,95,86,0.10)',
  greenBadgeBg: '#DCFCE7',
  greenBadgeTxt: '#16A34A',
  verifiedBg: 'rgba(0,95,86,0.10)',
  openBorder: '#D97706',
  openBg: 'rgba(217,119,6,0.08)',
  openTxt: '#B45309',
  pinnedBg: 'rgba(0,95,86,0.05)',
  pinnedBorder: 'rgba(0,95,86,0.25)',
  unreadBg: 'rgba(0,95,86,0.05)',
  unreadDot: '#005F56',
} as const;

export const Colors = {
  primary: color.brand[600],
  primaryContainer: color.brand[50],
  onPrimary: color.neutral[0],
  onPrimaryContainer: color.brand[800],
  inversePrimary: color.brand[200],
  primaryFixed: color.brand[100],
  primaryFixedDim: color.brand[200],

  secondary: color.neutral[600],
  onSecondary: color.neutral[0],
  secondaryContainer: color.neutral[100],
  onSecondaryContainer: color.neutral[800],

  tertiary: color.warning.solid,
  onTertiary: color.neutral[0],
  tertiaryContainer: color.warning.bg,
  onTertiaryContainer: color.warning.text,

  error: color.danger.solid,
  onError: color.neutral[0],
  errorContainer: color.danger.bg,
  onErrorContainer: color.danger.text,

  success: color.success.solid,
  successContainer: color.success.bg,
  onSuccessContainer: color.success.text,
  warning: color.warning.solid,
  warningContainer: color.warning.bg,
  onWarningContainer: color.warning.text,
  info: color.info.solid,
  infoContainer: color.info.bg,
  onInfoContainer: color.info.text,

  surface: color.neutral[50],
  surfaceDim: color.neutral[200],
  surfaceBright: color.neutral[50],
  surfaceContainerLowest: color.neutral[0],
  surfaceContainerLow: color.neutral[100],
  surfaceContainer: color.neutral[100],
  surfaceContainerHigh: color.neutral[200],
  surfaceContainerHighest: color.neutral[300],
  onSurface: color.neutral[900],
  onSurfaceVariant: color.neutral[600],
  inverseSurface: color.neutral[800],
  inverseOnSurface: color.neutral[50],

  outline: color.neutral[500],
  outlineVariant: color.neutral[200],
  surfaceTint: color.brand[600],
  background: color.neutral[50],
  onBackground: color.neutral[900],
  surfaceVariant: color.neutral[200],

  amber: color.warning.solid,
  amberLight: color.warning.bg,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  gutter: 16,
};

export const Radius = {
  sm: Number.parseInt(radius.sm, 10),
  md: Number.parseInt(radius.md, 10),
  lg: Number.parseInt(radius.lg, 10),
  xl: Number.parseInt(radius.lg, 10),
  full: 9999,
};

export const Typography = {
  displayLg: {
    fontFamily: shiftGoTokens.type.display,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700' as const,
  },
  titleMd: {
    fontFamily: shiftGoTokens.type.display,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700' as const,
  },
  titleSm: {
    fontFamily: shiftGoTokens.type.display,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  bodyMd: {
    fontFamily: shiftGoTokens.type.display,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodySm: {
    fontFamily: shiftGoTokens.type.display,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  labelSm: {
    fontFamily: shiftGoTokens.type.data,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  labelCaps: {
    fontFamily: shiftGoTokens.type.data,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
};

export const Shadow = {
  card: {
    shadowColor: color.neutral[900],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  button: {
    shadowColor: color.neutral[900],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  overlay: {
    shadowColor: color.neutral[900],
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 12,
  },
};
