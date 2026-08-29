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
      "primary": "#d51352",
      "primaryForeground": "#fff7fa",
      "secondary": "#fde7ef",
      "secondaryForeground": "#8e123f",
      "muted": "#f8f0f3",
      "mutedForeground": "#71848a",
      "accent": "#d4874f",
      "accentForeground": "#fffaf3",
      "destructive": "#b8544f",
      "destructiveForeground": "#fffaf3",
      "input": "#cad9d3",
      "ring": "#e54878",
      "chart1": "#d51352",
      "chart2": "#d4874f",
      "chart3": "#315b66",
      "chart4": "#9ab6a9",
      "chart5": "#d9b57b",
      "sidebar": "#173b48",
      "sidebarForeground": "#f8f5ee",
      "sidebarBorder": "#315b66",
      "sidebarPrimary": "#d51352",
      "sidebarPrimaryForeground": "#fff7fa",
      "sidebarAccent": "#641634",
      "sidebarAccentForeground": "#f8f5ee",
      "sidebarRing": "#ef6b96"
    },
    "dark": {
      "background": "#10242b",
      "foreground": "#f3f5f0",
      "border": "#2d4a51",
      "card": "#162f37",
      "cardForeground": "#f3f5f0",
      "popover": "#193740",
      "popoverForeground": "#f3f5f0",
      "primary": "#ef6b96",
      "primaryForeground": "#300817",
      "secondary": "#4f1b32",
      "secondaryForeground": "#ffd9e5",
      "muted": "#2a2028",
      "mutedForeground": "#a7bbb4",
      "accent": "#e0a06c",
      "accentForeground": "#10242b",
      "destructive": "#e07a72",
      "destructiveForeground": "#10242b",
      "input": "#35545a",
      "ring": "#ef6b96",
      "chart1": "#ef6b96",
      "chart2": "#e0a06c",
      "chart3": "#8bb3bf",
      "chart4": "#a7bbb4",
      "chart5": "#d9b57b",
      "sidebar": "#0d1d23",
      "sidebarForeground": "#f3f5f0",
      "sidebarBorder": "#29434b",
      "sidebarPrimary": "#ef6b96",
      "sidebarPrimaryForeground": "#300817",
      "sidebarAccent": "#4f1b32",
      "sidebarAccentForeground": "#fff0f5",
      "sidebarRing": "#f28bae"
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
