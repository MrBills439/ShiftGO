---
name: Care Management Platform
colors:
  surface: "#f6faf8"
  surface-dim: "#d7dbd9"
  surface-bright: "#f6faf8"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#f1f4f2"
  surface-container: "#ebefec"
  surface-container-high: "#e5e9e7"
  surface-container-highest: "#dfe3e1"
  on-surface: "#181c1b"
  on-surface-variant: "#3e4947"
  inverse-surface: "#2d3130"
  inverse-on-surface: "#eef2ef"
  outline: "#6e7977"
  outline-variant: "#bdc9c6"
  surface-tint: "#006b60"
  primary: "#005f55"
  on-primary: "#ffffff"
  primary-container: "#0d7a6e"
  on-primary-container: "#abfff0"
  inverse-primary: "#7dd6c8"
  secondary: "#565e71"
  on-secondary: "#ffffff"
  secondary-container: "#d8dff5"
  on-secondary-container: "#5b6375"
  tertiary: "#784a00"
  on-tertiary: "#ffffff"
  tertiary-container: "#996000"
  on-tertiary-container: "#ffecdb"
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  primary-fixed: "#99f3e4"
  primary-fixed-dim: "#7dd6c8"
  on-primary-fixed: "#00201c"
  on-primary-fixed-variant: "#005048"
  secondary-fixed: "#dbe2f8"
  secondary-fixed-dim: "#bfc6dc"
  on-secondary-fixed: "#131c2b"
  on-secondary-fixed-variant: "#3f4758"
  tertiary-fixed: "#ffddb8"
  tertiary-fixed-dim: "#ffb95f"
  on-tertiary-fixed: "#2a1700"
  on-tertiary-fixed-variant: "#653e00"
  background: "#f6faf8"
  on-background: "#181c1b"
  surface-variant: "#dfe3e1"
typography:
  display-lg:
    fontFamily: DM Sans
    fontSize: 48px
    fontWeight: "700"
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: DM Sans
    fontSize: 32px
    fontWeight: "600"
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: DM Sans
    fontSize: 28px
    fontWeight: "600"
    lineHeight: 36px
  title-md:
    fontFamily: DM Sans
    fontSize: 20px
    fontWeight: "500"
    lineHeight: 28px
  body-md:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 24px
  body-sm:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style

This design system establishes a premium, futuristic aesthetic tailored for the high-stakes environment of care support. The brand personality is clinical yet compassionate—balancing the rigorous efficiency of a workforce management tool with the human-centric nature of healthcare.

The visual direction utilizes a **Linear/Stripe** aesthetic, characterized by rhythmic vertical and horizontal lines that suggest organization and flow. We employ a refined **Glassmorphism** approach, using translucent surfaces to maintain a sense of depth and spatial awareness without sacrificing clarity. This is a "Technical-Humanist" style: it feels like advanced technology (futuristic) but remains accessible and grounded (premium care).

## Colors

The palette is rooted in **Primary Teal**, a color that evokes health, stability, and professional calm. It is supported by **Slate/Navy** for deep structural elements (sidebars, primary text), providing a high-contrast, authoritative foundation.

**Amber Alert** is reserved strictly for urgent status changes, shift conflicts, or critical notifications, ensuring high visibility without overwhelming the user. The **Surface Background** is a soft, off-white grey that reduces eye strain during long shifts, while **Teal Light** is used for subtle glassmorphic backgrounds and hover states to maintain a luminous, airy feel.

## Typography

We utilize **DM Sans** as the primary typeface for its modern, low-contrast geometric shapes which perform exceptionally well in both display and body sizes. It provides the "premium" feel requested while maintaining high legibility.

**Inter** is used as a secondary utility font for small labels, data tables, and technical metadata. This distinction ensures that while the interface feels designed and bespoke (DM Sans), the dense information remains functional and systematic (Inter). Headings should always use medium to bold weights to create a strong information hierarchy against the spacious layouts.

## Layout & Spacing

The layout philosophy is based on a **Spacious Hierarchy**. We use a strict 4px/8px incremental grid to ensure alignment across all components.

- **Desktop Dashboard:** Uses a fixed-width left sidebar (280px) with a fluid main content area. Content is capped at a max-width of 1440px to prevent excessive line lengths.
- **Mobile (iPhone 14 Pro):** A fluid grid with 16px side margins. Content relies on vertical stacking with a fixed bottom navigation bar for primary actions.
- **The Linear Motif:** Use subtle 1px borders (Teal Light or Slate at 10% opacity) to separate sections, reinforcing the "Stripe" aesthetic without using heavy containers.

## Elevation & Depth

This design system uses a combination of **Glassmorphism** and **Ambient Shadows** to define hierarchy.

1.  **Level 0 (Base):** The Surface Background (#F4F5F7).
2.  **Level 1 (Floating Cards):** Pure white background with a very soft, diffused shadow (0px 8px 24px rgba(26, 34, 50, 0.06)).
3.  **Level 2 (Glass Overlays):** Used for modals and navigation bars. A background blur of 12px combined with a semi-transparent white (rgba(255, 255, 255, 0.7)) and a 1px inner border to simulate a glass edge.
4.  **Level 3 (Urgent Pop-overs):** Toasts and notifications use a slightly deeper shadow and high-contrast Slate/Navy background to "break" the glass plane and command attention.

## Shapes

We adopt a **Rounded** shape language to soften the futuristic technicality of the app. Standard components (buttons, input fields) use a 12px radius, while primary containers and floating cards use a 16px radius.

Status badges and tags use a fully "pill-shaped" radius to differentiate them from interactive buttons. This distinction helps users quickly identify what is a piece of information versus a trigger for an action.

## Components

- **Buttons:** Primary buttons use a solid Primary Teal. Secondary buttons are outlined in Teal or Slate. All buttons feature a subtle gradient (top-to-bottom) for a "tactile-futuristic" sheen.
- **Smart Status Badges:** Use a light tint of the status color for the background and a dark, saturated version for the text. Include a small leading dot for visual rhythm.
- **Floating Cards:** These are the primary vessel for data. They should have a 16px corner radius, a subtle 1px border (#E1F5EE), and the "Level 1" shadow.
- **Input Fields:** Outlined style with a 12px radius. When focused, the border transitions to Primary Teal with a subtle 4px outer glow (Primary Teal at 10% opacity).
- **Elegant Notification Toasts:** Positioned top-center on mobile and bottom-right on desktop. They use a glassmorphic dark background (Slate/Navy at 90% opacity) with white typography.
- **Navigation:**
  - **Desktop:** Vertical sidebar with outlined Phosphor icons. Active states use a "Teal Light" background and a 4px vertical "Stripe" on the left edge.
  - **Mobile:** Bottom tab bar with a high backdrop-blur effect and soft-touch outlined icons.
- **Icons:** Use **Phosphor Icons** in the "Light" or "Regular" weight. Icons should always be outlined, never filled, to maintain the "Linear" aesthetic.
