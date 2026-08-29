/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f3f5f0",
      "foreground": "#173b48",
      "border": "#d8e2dd",
      "card": "#fbfcf8",
      "cardForeground": "#173b48",
      "popover": "#fbfcf8",
      "popoverForeground": "#173b48",
      "primary": "#397064",
      "primaryForeground": "#f8f5ee",
      "secondary": "#e3eee8",
      "secondaryForeground": "#315b66",
      "muted": "#edf4ef",
      "mutedForeground": "#71848a",
      "accent": "#d4874f",
      "accentForeground": "#fffaf3",
      "destructive": "#b8544f",
      "destructiveForeground": "#fffaf3",
      "input": "#cad9d3",
      "ring": "#4b8575",
      "chart1": "#397064",
      "chart2": "#d4874f",
      "chart3": "#315b66",
      "chart4": "#9ab6a9",
      "chart5": "#d9b57b",
      "sidebar": "#173b48",
      "sidebarForeground": "#f8f5ee",
      "sidebarBorder": "#315b66",
      "sidebarPrimary": "#397064",
      "sidebarPrimaryForeground": "#f8f5ee",
      "sidebarAccent": "#244f47",
      "sidebarAccentForeground": "#f8f5ee",
      "sidebarRing": "#8eae9e"
    },
    "dark": {
      "background": "#10242b",
      "foreground": "#f3f5f0",
      "border": "#2d4a51",
      "card": "#162f37",
      "cardForeground": "#f3f5f0",
      "popover": "#193740",
      "popoverForeground": "#f3f5f0",
      "primary": "#6ca998",
      "primaryForeground": "#10242b",
      "secondary": "#24444a",
      "secondaryForeground": "#e3eee8",
      "muted": "#1e3a42",
      "mutedForeground": "#a7bbb4",
      "accent": "#e0a06c",
      "accentForeground": "#10242b",
      "destructive": "#e07a72",
      "destructiveForeground": "#10242b",
      "input": "#35545a",
      "ring": "#8eae9e",
      "chart1": "#6ca998",
      "chart2": "#e0a06c",
      "chart3": "#8bb3bf",
      "chart4": "#a7bbb4",
      "chart5": "#d9b57b",
      "sidebar": "#0d1d23",
      "sidebarForeground": "#f3f5f0",
      "sidebarBorder": "#29434b",
      "sidebarPrimary": "#6ca998",
      "sidebarPrimaryForeground": "#10242b",
      "sidebarAccent": "#244f47",
      "sidebarAccentForeground": "#f3f5f0",
      "sidebarRing": "#8eae9e"
    }
  },
  "fontFamily": {
    "sans": [
      "DM Sans",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Geist Mono",
      "monospace"
    ]
  },
  "radius": "0.625rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
