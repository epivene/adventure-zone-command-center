/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#fff7fa",
      "foreground": "#17110f",
      "border": "#e4c7d2",
      "card": "#fffdfb",
      "cardForeground": "#17110f",
      "popover": "#fffdfb",
      "popoverForeground": "#17110f",
      "primary": "#d11a56",
      "primaryForeground": "#ffffff",
      "secondary": "#f2dce6",
      "secondaryForeground": "#73143a",
      "muted": "#faf0f4",
      "mutedForeground": "#69565f",
      "accent": "#f7c70b",
      "accentForeground": "#17110f",
      "destructive": "#b14237",
      "destructiveForeground": "#ffffff",
      "input": "#d9b5c3",
      "ring": "#d11a56",
      "chart1": "#d11a56",
      "chart2": "#f7c70b",
      "chart3": "#1558ae",
      "chart4": "#da235b",
      "chart5": "#d09764",
      "sidebar": "#080706",
      "sidebarForeground": "#fff7e8",
      "sidebarBorder": "#4d352b",
      "sidebarPrimary": "#d11a56",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#56122d",
      "sidebarAccentForeground": "#fff7e8",
      "sidebarRing": "#f7c70b"
    },
    "dark": {
      "background": "#100a0d",
      "foreground": "#fff7e8",
      "border": "#4d2634",
      "card": "#1c1117",
      "cardForeground": "#fff7e8",
      "popover": "#24151d",
      "popoverForeground": "#fff7e8",
      "primary": "#ef3a77",
      "primaryForeground": "#1a080f",
      "secondary": "#4a1830",
      "secondaryForeground": "#ffdce7",
      "muted": "#2b1c22",
      "mutedForeground": "#cfabb8",
      "accent": "#f7c70b",
      "accentForeground": "#17110f",
      "destructive": "#ef6b64",
      "destructiveForeground": "#1a080f",
      "input": "#633348",
      "ring": "#f7c70b",
      "chart1": "#ef3a77",
      "chart2": "#f7c70b",
      "chart3": "#5d91dc",
      "chart4": "#ff79a6",
      "chart5": "#e6aa75",
      "sidebar": "#050403",
      "sidebarForeground": "#fff7e8",
      "sidebarBorder": "#4d352b",
      "sidebarPrimary": "#ef3a77",
      "sidebarPrimaryForeground": "#1a080f",
      "sidebarAccent": "#4a1830",
      "sidebarAccentForeground": "#fff7e8",
      "sidebarRing": "#f7c70b"
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
