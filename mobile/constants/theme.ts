import { shiftGoTokens } from '../../design-system/tokens';

const { color, radius } = shiftGoTokens;

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
