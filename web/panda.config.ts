import { defineConfig } from "@pandacss/dev";

const fonts = {
  monoDisplay: '"Space Mono", ui-monospace, "Cascadia Mono", Menlo, monospace',
  monoBody: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, monospace',
  ui: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
};

function extractLayerBody(css: string, layerName: string) {
  const marker = `@layer ${layerName}{`;
  const start = css.indexOf(marker);
  if (start === -1) return "";

  const bodyStart = start + marker.length;
  let depth = 1;
  for (let i = bodyStart; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return css.slice(bodyStart, i).trim();
  }

  return "";
}

function appendUnlayeredAppStyles(css: string) {
  const unlayered = ["base", "recipes", "utilities"]
    .map((layer) => extractLayerBody(css, layer))
    .filter(Boolean)
    .join("\n\n");

  return `${css}\n\n/* Unlayered app styles: restores the cascade position formerly held by app.css/retro.css. */\n${unlayered}\n`;
}

/**
 * Common UI recipes shared across the migrated Tailwind → Panda CSS code.
 * These collapse the most frequently-inlined patterns (icon button,
 * destructive banner, chip/badge, field input, content card) into a
 * single typed selector so component code reads as `button({ variant })
 * instead of repeating 6-10 CSS properties per site.
 */
const recipes = {
  /** Square icon-only button (28/32/40 sizes). `tone=primary` fills with the
   * primary color; `tone=ghost` (default) just shows the hover accent. */
  iconButton: {
    className: "keating-icon-btn",
    base: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "0.375rem",
      flexShrink: 0,
      color: "var(--muted-foreground)",
      transitionProperty: "background-color, color",
      transitionDuration: "{durations.fast}",
      transitionTimingFunction: "{easings.standard}",
      "&:not(:disabled)": { cursor: "pointer" }
    },
    variants: {
      size: {
        sm: { height: "1.75rem", width: "1.75rem" },
        md: { height: "2rem", width: "2rem" },
        lg: { height: "2.25rem", width: "2.25rem" }
      },
      tone: {
        ghost: {
          _hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
          _disabled: { opacity: 0.5 }
        },
        primary: {
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          _hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" },
          _disabled: { opacity: 0.5 }
        }
      }
    },
    defaultVariants: { size: "sm", tone: "ghost" }
  },

  /** Small status label / chip — uses `intent` to choose the color story. */
  chip: {
    className: "keating-chip",
    base: {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.125rem",
      flexShrink: 0,
      borderRadius: "0.25rem",
      fontSize: "0.625rem",
      fontWeight: 500
    },
    variants: {
      size: {
        sm: { padding: "0.125rem 0.375rem" },
        md: { padding: "0.25rem 0.5rem", fontSize: "0.6875rem" }
      },
      intent: {
        muted: { background: "var(--muted)", color: "var(--muted-foreground)" },
        primary: { background: "var(--primary)", color: "var(--primary-foreground)" },
        plain: {}
      }
    },
    defaultVariants: { size: "sm", intent: "muted" }
  },

  /**
   * Highlighted row for "Delete session?" / error-message surfaces.
   * `layout=row` (default) is the confirm-delete pattern (label + button);
   * `layout=block` is a plain padded error box (e.g. a form error message).
   */
  dangerBanner: {
    className: "keating-danger-banner",
    base: {
      borderRadius: "0.375rem",
      border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)",
      background: "color-mix(in srgb, var(--destructive) 5%, transparent)",
      padding: "0.75rem",
      fontSize: "0.875rem",
      color: "var(--destructive)"
    },
    variants: {
      layout: {
        row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" },
        block: {}
      }
    },
    defaultVariants: { layout: "row" }
  },

  /**
   * Settings panel primitives. Replaces a triplicated set of `section*Class`
   * declarations across KeatingUiSettingsTab, SpeechSettingsTab, and the
   * `settings/*Section.tsx` panels. Use one of these in every settings card.
   */
  settingsSection: {
    className: "keating-settings-section",
    base: {
      display: "flex",
      flexDirection: "column",
      gap: "1rem"
    }
  },

  /** Stacked card surface used inside settings panels for a single setting. */
  settingsCard: {
    className: "keating-settings-card",
    base: {
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
      borderRadius: "0.5rem",
      border: "1px solid var(--border)",
      padding: "1rem",
      sm: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }
    },
    variants: {
      tone: {
        default: {},
        subtle: { gap: "1rem", sm: { alignItems: "center" } }
      }
    },
    defaultVariants: { tone: "default" }
  },

  /**
   * Field-level text input / select / number-input. Replaces the per-file
   * `responsiveSelectClass`/`wideResponsiveInputClass` duplicates.
   * Use `fieldInput({ size: "auto" })` for select-style inline controls.
   */
  fieldInput: {
    className: "keating-field-input",
    base: {
      width: "100%",
      borderRadius: "0.375rem",
      border: "1px solid var(--border)",
      backgroundColor: "var(--background)",
      paddingInline: "0.75rem",
      paddingBlock: "0.5rem",
      fontSize: "0.875rem",
      color: "var(--foreground)",
      outline: "none",
      _placeholder: { color: "var(--muted-foreground)" },
      _focus: { borderColor: "var(--ring)" },
      sm: { width: "auto" }
    },
    variants: {
      size: {
        auto: { sm: { minWidth: "11rem" } },
        wide: { sm: { minWidth: "16rem" } },
        tight: { height: "2.25rem", sm: { minWidth: "4rem", paddingInline: "0.5rem" } }
      }
    },
    defaultVariants: { size: "auto" }
  },

  /** Primary action button used in settings panels. */
  primaryButton: {
    className: "keating-primary-button",
    base: {
      display: "inline-flex",
      height: "2.25rem",
      alignItems: "center",
      justifyContent: "center",
      gap: "0.5rem",
      borderRadius: "0.375rem",
      backgroundColor: "var(--primary)",
      paddingInline: "1rem",
      fontSize: "0.875rem",
      fontWeight: 500,
      color: "var(--primary-foreground)",
      transitionProperty: "background-color",
      transitionDuration: "{durations.fast}",
      transitionTimingFunction: "{easings.standard}",
      _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, black)" },
      _disabled: { opacity: 0.5, cursor: "not-allowed" }
    }
  },

  /** Outline / secondary button used for cancel / less-emphatic actions. */
  outlineButton: {
    className: "keating-outline-button",
    base: {
      display: "inline-flex",
      height: "2.25rem",
      alignItems: "center",
      justifyContent: "center",
      gap: "0.5rem",
      borderRadius: "0.375rem",
      border: "1px solid var(--border)",
      paddingInline: "1rem",
      fontSize: "0.875rem",
      fontWeight: 500,
      transitionProperty: "color, background-color, border-color",
      transitionDuration: "150ms",
      _hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
      _disabled: { opacity: 0.5 }
    }
  },

  /** Multi-line text input used in panels (persona prompt, system prompt, …). */
  textarea: {
    className: "keating-textarea",
    base: {
      minHeight: "17.5rem",
      width: "100%",
      resize: "vertical",
      borderRadius: "0.5rem",
      border: "1px solid var(--border)",
      backgroundColor: "var(--background)",
      padding: "0.75rem",
      fontFamily: "var(--mono-display)",
      fontSize: "0.75rem",
      lineHeight: "1.25rem",
      color: "var(--foreground)",
      outline: "none",
      _focus: { borderColor: "var(--ring)" }
    }
  },

  /**
   * Marketing "hard-shadow push button" from the old `.btn-retro` /
   * `.btn-retro-primary` CSS. Ported 1:1 (same gradients, box-shadow offsets,
   * hover/active/focus transforms).
   * `tone=primary` is the solid-accent CTA variant; `tone=default` is the
   * paper-card outline button.
   */
  btnRetro: {
    className: "keating-btn-retro",
    base: {
      padding: "10px",
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      minHeight: "46px",
      overflow: "hidden",
      isolation: "isolate",
      border: "2px solid var(--ink)",
      fontFamily: "var(--mono-body)",
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      transitionProperty: "color, background-color, border-color, transform, box-shadow",
      transitionDuration: "{durations.fast}",
      transitionTimingFunction: "{easings.standard}",
      _before: {
        content: '""',
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background:
          "repeating-linear-gradient(90deg, transparent 0 9px, color-mix(in srgb, var(--ink) 6%, transparent) 9px 10px)",
        opacity: 0,
        pointerEvents: "none",
        transitionProperty: "opacity",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.standard}"
      },
      _after: {
        content: '""',
        position: "absolute",
        inset: "4px",
        zIndex: 0,
        border: "1px solid color-mix(in srgb, var(--ink) 18%, transparent)",
        opacity: 0.65,
        pointerEvents: "none"
      },
      "&:hover::before, &:focus-visible::before": { opacity: 1 },
      _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "3px" }
    },
    variants: {
      tone: {
        default: {
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.36), transparent 48%), var(--card)",
          color: "var(--ink)",
          textShadow: "0 1px 0 rgba(255, 255, 255, 0.35)",
          boxShadow:
            "4px 4px 0 var(--ink), inset 0 -3px 0 color-mix(in srgb, var(--ink) 14%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
          _hover: {
            transform: "translate(-1px, -1px)",
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.4), transparent 45%), color-mix(in srgb, var(--accent) 12%, var(--card))",
            boxShadow:
              "5px 5px 0 var(--ink), inset 0 -3px 0 color-mix(in srgb, var(--ink) 14%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
            color: "var(--accent-dim)"
          },
          _active: {
            transform: "translate(3px, 3px)",
            boxShadow: "1px 1px 0 var(--ink), inset 0 2px 0 color-mix(in srgb, var(--ink) 18%, transparent)"
          }
        },
        primary: {
          "--accent": "#1e9b50",
          background: "linear-gradient(180deg, color-mix(in srgb, #fff 24%, transparent), transparent 48%), var(--accent)",
          color: "#fff",
          borderColor: "var(--accent-dim)",
          textShadow: "0 1px 0 rgba(12, 21, 16, 0.35)",
          boxShadow:
            "4px 4px 0 var(--accent-dim), inset 0 -3px 0 color-mix(in srgb, var(--terminal) 22%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.34)",
          _dark: { color: "var(--terminal)" },
          _hover: {
            transform: "translate(-1px, -1px)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, #fff 28%, transparent), transparent 48%), color-mix(in srgb, var(--accent) 86%, var(--phosphor))",
            boxShadow:
              "5px 5px 0 var(--accent-dim), inset 0 -3px 0 color-mix(in srgb, var(--terminal) 22%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.38)",
            color: "#fff",
            _dark: { color: "var(--terminal)" }
          },
          _active: {
            transform: "translate(3px, 3px)",
            boxShadow: "1px 1px 0 var(--accent-dim), inset 0 2px 0 color-mix(in srgb, var(--terminal) 22%, transparent)"
          }
        }
      }
    },
    defaultVariants: { tone: "default" }
  },

  /**
   * Marketing "eyebrow" label that sits above section titles on the
   * landing/download/pricing pages (e.g. "The Hyperteacher", "cat PRICING.txt").
   * Ported from the old `.retro-layout .eyebrow` rule (plus the `.dark` color
   * override). No variants — single visual identity.
   */
  eyebrow: {
    className: "keating-eyebrow",
    base: {
      fontFamily: "var(--mono-body)",
      fontSize: "11px",
      letterSpacing: "0.18em",
      color: "var(--accent-dim)",
      textTransform: "uppercase",
      fontWeight: 600,
      _dark: { color: "var(--phosphor)" }
    }
  },

  /**
   * Three section-heading primitives ported 1:1 with no
   * variants — `sectionHead` is the flex row that wraps the title, `sectionTitle`
   * is the h2 inside it, `sectionLede` is the supporting paragraph beneath.
   */
  sectionHead: {
    className: "keating-section-head",
    base: {
      display: "flex",
      alignItems: "baseline",
      gap: "18px",
      flexWrap: "wrap",
      marginBottom: "14px"
    }
  },
  sectionTitle: {
    className: "keating-section-title",
    base: {
      fontFamily: "var(--mono-display)",
      fontWeight: 700,
      fontSize: "clamp(24px, 3vw, 34px)",
      letterSpacing: "-0.01em",
      marginBottom: "12px"
    }
  },
  sectionLede: {
    className: "keating-section-lede",
    base: {
      color: "var(--ink-soft)",
      maxWidth: "62ch",
      marginBottom: "42px"
    }
  },

  /**
   * "Capability card" from the landing page's features grid. The card has a
   * hard-shadow hover lift, and the icon inside spins/scales on hover too
   * (a nested selector that hits the sibling `capIcon` recipe's generated
   * class — the same nesting pattern used for `_before`/`_after` in
   * `btnRetro`). `h3`/`p` descendants are styled inline so consumers
   * don't have to import extra recipes per call site.
   */
  capCard: {
    className: "keating-cap-card",
    base: {
      background: "var(--card)",
      border: "1.5px solid var(--ink)",
      padding: "24px 22px 26px",
      boxShadow: "var(--shadow-card)",
      transitionProperty: "transform, box-shadow",
      transitionDuration: "0.16s",
      transitionTimingFunction: "ease",
      _hover: {
        transform: "translateY(-4px)",
        boxShadow: "5px 5px 0 var(--ink)",
        "& .keating-cap-icon": { transform: "rotate(-5deg) scale(1.08)" }
      },
      "& h3": {
        fontFamily: "var(--mono-display)",
        fontSize: "15.5px",
        letterSpacing: "0.02em",
        marginBottom: "8px",
        lineHeight: 1.4,
        color: "var(--ink)"
      },
      "& p": {
        color: "var(--ink-soft)",
        fontSize: "12.8px",
        lineHeight: 1.7
      }
    }
  },

  /** Image rendered inside a `capCard`. Has its own bouncy transition so the
   * cross-hover rule in `capCard` (`& .keating-cap-icon`) can target it. */
  capIcon: {
    className: "keating-cap-icon",
    base: {
      width: "62px",
      height: "auto",
      marginBottom: "16px",
      transitionProperty: "transform",
      transitionDuration: "0.25s",
      transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    }
  },

  /**
   * Paper-textured card surface from the old `.paper-fold` +
   * `.distressed-border`. Every call site in the app used the two together
   * (legal docs, blog posts, the paper/commit-review pages), so they're
   * merged into one recipe rather than two classes that are never used
   * alone. IMPORTANT: both original classes declare a `::before` on the
   * *same* element, so they cascade into one pseudo-element, not two
   * stacked ones — `.distressed-border::before` (declared later in the
   * source file) wins per-property on every property it shares with
   * `.paper-fold::before` (content/position/top/left/right/background),
   * fully masking paper-fold's translucent gradient. Only `height`
   * (paper-fold-only) and `pointer-events` (paper-fold-only) survive
   * alongside distressed-border's `bottom`/`clip-path`/`z-index`. This
   * single `_before` block reproduces that exact merged cascade result —
   * do not "restore" the paper-fold gradient, it was never visible.
   */
  paperCard: {
    className: "keating-paper-card",
    base: {
      position: "relative",
      background: "var(--paper)",
      border: "2px solid var(--ink)",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1), 0 0 40px rgba(0, 0, 0, 0.05) inset",
      _before: {
        content: '""',
        position: "absolute",
        top: "-2px",
        left: "-2px",
        right: "-2px",
        bottom: "-2px",
        height: "100%",
        background: "var(--paper)",
        clipPath:
          "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 95%, 2% 95%, 2% 90%, 0% 90%, 0% 85%, 3% 85%, 3% 80%, 0% 80%, 0% 75%, 1% 75%, 1% 70%, 0% 70%, 0% 65%, 2% 65%, 2% 60%, 0% 60%, 0% 55%, 1% 55%, 1% 50%, 0% 50%, 0% 45%, 3% 45%, 3% 40%, 0% 40%, 0% 35%, 2% 35%, 2% 30%, 0% 30%, 0% 25%, 1% 25%, 1% 20%, 0% 20%, 0% 15%, 2% 15%, 2% 10%, 0% 10%, 0% 5%, 1% 5%, 1% 0%)",
        zIndex: -1,
        pointerEvents: "none"
      }
    }
  }
} as const;

export default defineConfig({
  preflight: true,
  jsxFramework: "react",
  jsxStyleProps: "none",
  include: [
    "./src/**/*.{ts,tsx,js,jsx}",
    "./server/**/*.{ts,tsx,js,jsx}",
    "./.storybook/**/*.{ts,tsx,js,jsx}",
    "./index.html"
  ],
  exclude: ["node_modules", "dist", ".output", "public"],
  outdir: "styled-system",
  theme: {
    extend: {
      tokens: {
        colors: {
          terminal: { value: "#0c1510" },
          terminalEdge: { value: "#1b2a1f" },
          phosphor: { value: "#4be388" },
          phosphorDim: { value: "#2e9a5c" },
          amber: { value: "#e8a33d" },
          red: { value: "#d5604b" },
          greenWash: { value: "#ddebdd" },
          chart4: { value: "#e8a33d" },
          chart5: { value: "#d5604b" }
        },
        fonts: {
          monoDisplay: { value: fonts.monoDisplay },
          monoBody: { value: fonts.monoBody },
          ui: { value: fonts.ui },
          sans: { value: '"Roboto", "Segoe UI", Arial, sans-serif' },
          serif: { value: 'Georgia, Cambria, "Times New Roman", Times, serif' },
          mono: {
            value:
              '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }
        },
        radii: {
          keating: { value: "0.25rem" }
        },
        shadows: {
          hard: { value: "4px 4px 0 var(--ink)" },
          crt: { value: "6px 6px 0 var(--ink)" }
        },
        durations: {
          fast: { value: "120ms" },
          base: { value: "180ms" },
          slow: { value: "300ms" }
        },
        easings: {
          standard: { value: "cubic-bezier(0.4, 0, 0.2, 1)" }
        }
      },
      /**
       * Theme-aware colors: single source of truth for values that flip
       * between light/dark. Panda emits real :root/.dark rules for these
       * using the built-in `dark` condition (`.dark &`, matching the class
       * ThemeToggle.tsx toggles on <html>) — see the `dark` alias table in
       * `globalCss` below, which re-exposes each one under the bare
       * `--name` custom property that the rest of the app already reads
       * via `var(--name)`, so no call-site changes were needed.
       */
      semanticTokens: {
        colors: {
          paper: { value: { base: "#f1ece0", _dark: "#0c1510" } },
          paperDeep: { value: { base: "#e9e2d2", _dark: "#0a110d" } },
          card: { value: { base: "#f6f2e8", _dark: "#11201a" } },
          ink: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          inkSoft: { value: { base: "#4a5247", _dark: "#9dbfa8" } },
          accent: { value: { base: "#1e9b50", _dark: "#1e9b50" } },
          accentDim: { value: { base: "#14743c", _dark: "#4be388" } },
          line: { value: { base: "rgba(28, 33, 27, 0.22)", _dark: "rgba(75, 227, 136, 0.28)" } },
          lineSoft: { value: { base: "rgba(28, 33, 27, 0.12)", _dark: "rgba(75, 227, 136, 0.14)" } },
          background: { value: { base: "#f1ece0", _dark: "#0c1510" } },
          foreground: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          cardForeground: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          popover: { value: { base: "#f6f2e8", _dark: "#11201a" } },
          popoverForeground: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          primary: { value: { base: "#1e9b50", _dark: "#4be388" } },
          primaryForeground: { value: { base: "#ffffff", _dark: "#0c1510" } },
          secondary: { value: { base: "#e9e2d2", _dark: "#1b2a1f" } },
          secondaryForeground: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          muted: { value: { base: "#e9e2d2", _dark: "#16231b" } },
          mutedForeground: { value: { base: "#4a5247", _dark: "#8fbf9e" } },
          accentSurface: { value: { base: "#ddebdd", _dark: "rgba(75, 227, 136, 0.12)" } },
          accentSurfaceForeground: { value: { base: "#14743c", _dark: "#4be388" } },
          destructive: { value: { base: "#b9432e", _dark: "#d5604b" } },
          destructiveForeground: { value: { base: "#ffffff", _dark: "#f1ece0" } },
          border: { value: { base: "#1c211b", _dark: "rgba(75, 227, 136, 0.28)" } },
          input: { value: { base: "#1c211b", _dark: "rgba(75, 227, 136, 0.32)" } },
          ring: { value: { base: "#1e9b50", _dark: "#4be388" } },
          chart1: { value: { base: "#1e9b50", _dark: "#4be388" } },
          chart2: { value: { base: "#14743c", _dark: "#2e9a5c" } },
          chart3: { value: { base: "#2e9a5c", _dark: "#1e9b50" } },
          sidebar: { value: { base: "#e9e2d2", _dark: "#0a110d" } },
          sidebarForeground: { value: { base: "#1c211b", _dark: "#dcefe0" } },
          sidebarPrimary: { value: { base: "#1e9b50", _dark: "#4be388" } },
          sidebarPrimaryForeground: { value: { base: "#ffffff", _dark: "#0c1510" } },
          sidebarAccent: { value: { base: "#ddebdd", _dark: "rgba(75, 227, 136, 0.12)" } },
          sidebarAccentForeground: { value: { base: "#14743c", _dark: "#4be388" } },
          sidebarBorder: { value: { base: "#1c211b", _dark: "rgba(75, 227, 136, 0.28)" } },
          sidebarRing: { value: { base: "#1e9b50", _dark: "#4be388" } }
        },
        shadows: {
          card: {
            value: {
              base: "0 1px 0 rgba(28, 33, 27, 0.06), 0 10px 28px -18px rgba(28, 33, 27, 0.35)",
              _dark: "0 1px 0 rgba(0, 0, 0, 0.4), 0 10px 28px -18px rgba(0, 0, 0, 0.8)"
            }
          }
        }
      },
      recipes,
      /**
       * Keyframes previously declared in local CSS. Panda emits the
       * animation definitions into the generated stylesheet under each name
       * here, so the `animation: <name>` declarations on component classes
       * resolve unchanged. Bodies are kept verbatim from the
       * original @keyframes blocks (including the rgba(...) opacity
       * literals) — per the audit rule "do not touch values without a
       * matching token": `rgba(245, 158, 11, ...)` is Tailwind amber-500
       * (`#f59e0b`) which doesn't match the Keating `--amber` token
       * (`#e8a33d`), and the chat-pulse-ring `rgba(30, 155, 80, ...)` is
       * the light-mode `--primary` literal kept constant across themes.
       */
      keyframes: {
        "session-fork-pulse": {
          "0%": {
            transform: "translateX(0)",
            filter: "none"
          },
          "35%": {
            transform: "translateX(8px)",
            filter: "drop-shadow(-6px 0 0 color-mix(in srgb, var(--chat-accent) 35%, transparent))"
          },
          "100%": {
            transform: "translateX(0)",
            filter: "none"
          }
        },
        "session-fork-arrive": {
          "0%": {
            transform: "translateX(-10px)",
            background: "color-mix(in srgb, var(--chat-accent) 22%, transparent)"
          },
          "100%": {
            transform: "translateX(0)",
            background: "transparent"
          }
        },
        "chat-persistence-scroll": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" }
        },
        "chat-pulse-ring": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(30, 155, 80, 0.5)"
          },
          "55%": {
            boxShadow: "0 0 0 6px rgba(30, 155, 80, 0)"
          }
        },
		"keating-mascot-think": {
			"0%, 100%": { transform: "translateY(0) rotate(-2deg)" },
			"50%": { transform: "translateY(-3px) rotate(3deg)" }
		},
		"keating-live-connect": {
			"0%, 100%": { transform: "translateY(1px) scale(0.985)" },
			"50%": { transform: "translateY(-1px) scale(1.015)" }
		},
		"keating-live-idle": {
			"0%, 100%": { transform: "translateY(0) rotate(0deg)" },
			"45%": { transform: "translateY(-2px) rotate(-0.75deg)" },
			"55%": { transform: "translateY(-2px) rotate(0.75deg)" }
		},
		"keating-live-listen": {
			"0%, 100%": { transform: "translateX(-1px) rotate(-1.5deg) scale(1.01)" },
			"50%": { transform: "translateX(1px) rotate(1.5deg) scale(1.025)" }
		},
		"keating-live-speak": {
			"0%, 100%": { transform: "translateY(0) scale(1.02)" },
			"30%": { transform: "translateY(-3px) rotate(-1deg) scale(1.055)" },
			"65%": { transform: "translateY(1px) rotate(1deg) scale(1.035)" }
		},
		"keating-live-work": {
			"0%, 100%": { transform: "translateX(0) rotate(0deg)" },
			"28%": { transform: "translateX(-2px) rotate(-3deg)" },
			"58%": { transform: "translateX(1px) rotate(1.5deg)" },
			"78%": { transform: "translateX(2px) rotate(3deg)" }
		},
		"keating-thinking-dot": {
			"0%, 60%, 100%": { opacity: 0.28, transform: "translateY(0)" },
			"30%": { opacity: 1, transform: "translateY(-2px)" }
		},
        "flashcard-exit-left": {
          to: { transform: "translateX(-130%) rotate(-10deg)", opacity: 0 }
        },
        "flashcard-exit-right": {
          to: { transform: "translateX(130%) rotate(10deg)", opacity: 0 }
        },
        "flashcard-exit-up": {
          to: { transform: "translateY(-120%) rotate(3deg)", opacity: 0 }
        },
        "flashcard-exit-down": {
          to: { transform: "translateY(120%) rotate(-3deg)", opacity: 0 }
        },
        "flashcard-exit-fade": {
          to: { transform: "scale(0.92)", opacity: 0 }
        },
        "flashcard-enter": {
          from: { transform: "translateY(14px) scale(0.97)", opacity: 0 },
          to: { transform: "translateY(0) scale(1)", opacity: 1 }
        },
        "flashcard-streak-pop": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.35)" },
          "100%": { transform: "scale(1)" }
        },
        "flashcard-milestone-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(245, 158, 11, 0.55)" },
          "100%": { boxShadow: "0 0 0 12px rgba(245, 158, 11, 0)" }
        },
"retro-glitch": {
          "0%,\n  100%": {
            transform: "translate(0)"
          },
          "20%": {
            transform: "translate(-2px, 1px)"
          },
          "40%": {
            transform: "translate(2px, -1px)"
          },
          "60%": {
            transform: "translate(-1px, -1px)"
          },
          "80%": {
            transform: "translate(1px, 2px)"
          }
        },
        "retro-scanlines": {
          "0%": {
            transform: "translateY(0)"
          },
          "100%": {
            transform: "translateY(2px)"
          }
        },
        "retro-blink": {
          "50%": {
            opacity: "0"
          }
        },
        "retro-typing": {
          from: {
            width: "0"
          },
          to: {
            width: "100%"
          }
        },
        "retro-boot-line": {
          "0%": {
            opacity: "0",
            transform: "translateX(-10px)"
          },
          "100%": {
            opacity: "1",
            transform: "translateX(0)"
          }
        },
        "retro-marquee": {
          "0%": {
            transform: "translateX(100%)"
          },
          "100%": {
            transform: "translateX(-100%)"
          }
        },
        "retro-cursor-blink": {
          "50%": {
            opacity: "0"
          }
        },
        "retro-hover-bob": {
          "0%,\n  100%": {
            transform: "translateY(0)"
          },
          "50%": {
            transform: "translateY(-9px)"
          }
        },
        "retro-shadow-bob": {
          "0%,\n  100%": {
            transform: "scaleX(1)",
            opacity: "0.9"
          },
          "50%": {
            transform: "scaleX(0.86)",
            opacity: "0.6"
          }
        },
        "retro-flicker": {
          "0%, 100%": {
            opacity: "1"
          },
          "3%": {
            opacity: "0.92"
          },
          "6%": {
            opacity: "1"
          },
          "42%": {
            opacity: "1"
          },
          "43%": {
            opacity: "0.88"
          },
          "44%": {
            opacity: "1"
          },
          "71%": {
            opacity: "0.95"
          },
          "72%": {
            opacity: "1"
          }
        },
        "retro-pulse-ring": {
          "0%,\n  100%": {
            boxShadow: "0 0 0 0 rgba(30, 155, 80, 0.5)"
          },
          "55%": {
            boxShadow: "0 0 0 6px rgba(30, 155, 80, 0)"
          }
        },
        /** Sweeps a highlight across the bar while a size is still unknown. */
        "model-download-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" }
        },
        /**
         * Drifting stripes over the filled part: on a multi-GB download the
         * width can look frozen for a minute even while bytes are arriving.
         */
        "model-download-stripes": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "24px 0" }
        }
}
    }
  },
  globalCss: {
    /* Single source of truth for CSS custom properties. Values live above
       in theme.extend.tokens/semanticTokens (idiomatic Panda — Panda emits
       the real :root/.dark rules for the semantic ones via the `dark`
       condition). This block just re-exposes each token under the bare
       `--name` custom property the codebase already consumes via
       var(--name), so ~2,200 existing call sites didn't need to change. */
    ":root": {
      "--paper": "{colors.paper}",
      "--paper-deep": "{colors.paperDeep}",
      "--card": "{colors.card}",
      "--ink": "{colors.ink}",
      "--ink-soft": "{colors.inkSoft}",
      "--green": "{colors.accent}",
      "--green-deep": "{colors.accentDim}",
      "--green-wash": "{colors.greenWash}",
      "--crt": "{colors.terminal}",
      "--crt-edge": "{colors.terminalEdge}",
      "--phosphor": "{colors.phosphor}",
      "--phosphor-dim": "{colors.phosphorDim}",
      "--amber": "{colors.amber}",
      "--red": "{colors.red}",
      "--line": "{colors.line}",
      "--line-soft": "{colors.lineSoft}",
      "--accent-green": "{colors.accent}",
      "--accent-dim": "{colors.accentDim}",
      "--terminal": "{colors.terminal}",
      "--terminal-edge": "{colors.terminalEdge}",
      "--shadow-card": "{shadows.card}",
      "--mono-display": "{fonts.monoDisplay}",
      "--mono-body": "{fonts.monoBody}",
      "--font-ui": "{fonts.ui}",
      "--background": "{colors.background}",
      "--foreground": "{colors.foreground}",
      "--card-foreground": "{colors.cardForeground}",
      "--popover": "{colors.popover}",
      "--popover-foreground": "{colors.popoverForeground}",
      "--primary": "{colors.primary}",
      "--primary-foreground": "{colors.primaryForeground}",
      "--secondary": "{colors.secondary}",
      "--secondary-foreground": "{colors.secondaryForeground}",
      "--muted": "{colors.muted}",
      "--muted-foreground": "{colors.mutedForeground}",
      "--accent": "{colors.accentSurface}",
      "--accent-foreground": "{colors.accentSurfaceForeground}",
      "--destructive": "{colors.destructive}",
      "--destructive-foreground": "{colors.destructiveForeground}",
      "--border": "{colors.border}",
      "--input": "{colors.input}",
      "--ring": "{colors.ring}",
      "--chart-1": "{colors.chart1}",
      "--chart-2": "{colors.chart2}",
      "--chart-3": "{colors.chart3}",
      "--chart-4": "{colors.chart4}",
      "--chart-5": "{colors.chart5}",
      "--sidebar": "{colors.sidebar}",
      "--sidebar-foreground": "{colors.sidebarForeground}",
      "--sidebar-primary": "{colors.sidebarPrimary}",
      "--sidebar-primary-foreground": "{colors.sidebarPrimaryForeground}",
      "--sidebar-accent": "{colors.sidebarAccent}",
      "--sidebar-accent-foreground": "{colors.sidebarAccentForeground}",
      "--sidebar-border": "{colors.sidebarBorder}",
      "--sidebar-ring": "{colors.sidebarRing}",
      "--font-sans": "{fonts.sans}",
      "--font-serif": "{fonts.serif}",
      "--font-mono": "{fonts.mono}",
      "--radius": "{radii.keating}",
      "--color-primary": "var(--primary)"
    },
    ".keating-artifact": {
      minHeight: "100vh",
      padding: "clamp(1rem, 3vw, 2.5rem)"
    },
    ".keating-artifact-shell": {
      width: "min(92vw, 1280px)",
      margin: "0 auto",
      display: "grid",
      gap: "1rem"
    },
    ".keating-artifact-header": {
      display: "flex",
      justifyContent: "space-between",
      gap: "1rem",
      alignItems: "end",
      border: "1.5px solid var(--ink)",
      background: "var(--card)",
      boxShadow: "4px 4px 0 var(--ink)",
      padding: "clamp(1rem, 2vw, 1.5rem)"
    },
    ".keating-artifact-title": {
      margin: "0.25rem 0 0",
      color: "var(--accent-dim)",
      fontFamily: "var(--mono-display)",
      fontSize: "clamp(1.8rem, 4vw, 3.5rem)",
      lineHeight: "1.05",
      letterSpacing: "-0.025em"
    },
    ".keating-artifact-meta": {
      color: "var(--ink-soft)",
      fontSize: "0.78rem",
      letterSpacing: "0.12em",
      textTransform: "uppercase"
    },
    ".keating-artifact-links": {
      display: "grid",
      gap: "0.35rem",
      justifyItems: "end",
      fontSize: "0.86rem"
    },
    ".keating-crt-panel": {
      position: "relative",
      overflow: "hidden",
      border: "1.5px solid var(--ink)",
      background: "var(--terminal)",
      color: "var(--phosphor)",
      boxShadow: "6px 6px 0 var(--ink)"
    },
    ".keating-crt-panel::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px)",
      mixBlendMode: "multiply"
    },
    "@media (max-width: 720px)": {
      ".keating-artifact-header": {
        alignItems: "start",
        flexDirection: "column"
      },
      ".keating-artifact-links": {
        justifyItems: "start"
      }
    },
    /* Global app, chat, and retro-page selectors migrated into Panda. */
    "html,\nbody,\n#root": {
      height: "100%",
      margin: "0",
      padding: "0"
    },
    body: {
      fontFamily: "var(--font-sans)"
    },
    "input,\ntextarea,\nselect": {
      fontFamily: "var(--font-ui)"
    },
    ".font-ui": {
      fontFamily: "var(--font-ui)"
    },
    html: {
      transform: "scale(100%)",
      fontSize: "130%",
      transition: "color-scheme 0.2s ease"
    },
    "::selection": {
      background: "var(--green)",
      color: "var(--primary-foreground)"
    },
    ".dark ::selection": {
      background: "var(--phosphor)",
      color: "var(--crt)"
    },
    ":focus-visible": {
      outline: "2px solid var(--ring)",
      outlineOffset: "2px"
    },
    "button:not(:disabled)": {
      transition: "transform 0.08s ease-out,\n    background-color 0.12s ease"
    },
    "*": {
      scrollbarWidth: "thin",
      scrollbarColor: "var(--border) transparent"
    },
    ".chat-page-shell": {
      height: "100dvh",
      minHeight: "100dvh",
      "--chat-paper": "var(--paper)",
      "--chat-ink": "var(--ink)",
      "--chat-accent": "var(--primary)"
    },
    ".chat-page-panel": {
      height: "100%",
      minHeight: "0",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    },
    ".chat-header": {
      minWidth: "0"
    },
    ".chat-brand": {
      maxWidth: "min(44vw, 14rem)",
      border: "2px solid transparent",
      transition: "background-color 0.15s ease,\n    border-color 0.15s ease,\n    color 0.15s ease,\n    transform 0.15s ease,\n    box-shadow 0.15s ease"
    },
    ".chat-brand img": {
      transition: "transform 0.15s ease,\n    filter 0.15s ease"
    },
    ".chat-brand:hover,\n.chat-brand:focus-visible": {
      borderColor: "color-mix(in srgb, var(--chat-accent) 55%, transparent)",
      background: "color-mix(in srgb, var(--chat-accent) 12%, transparent)",
      color: "var(--chat-accent)",
      boxShadow: "2px 2px 0 color-mix(in srgb, var(--chat-accent) 55%, transparent)",
      transform: "translateY(-1px)"
    },
    ".chat-brand:hover img,\n.chat-brand:focus-visible img": {
      filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--chat-accent) 55%, transparent))",
      transform: "rotate(-3deg) scale(1.06)"
    },
    ".chat-brand:active": {
      boxShadow: "1px 1px 0 color-mix(in srgb, var(--chat-accent) 55%, transparent)",
      transform: "translate(1px, 1px)"
    },
    ".chat-actions": {
      overscrollBehaviorX: "contain",
      scrollSnapType: "x proximity"
    },
    ".chat-action-button,\n.chat-actions > button": {
      width: "2.25rem",
      height: "2.25rem",
      padding: "0"
    },
    ".chat-only-desktop": {
      display: "none"
    },
    "message-editor textarea": {
      fontFamily: "var(--font-ui) !important",
      color: "var(--foreground) !important",
      WebkitTextFillColor: "var(--foreground) !important",
      caretColor: "var(--foreground) !important",
      opacity: "1 !important",
      textShadow: "none !important"
    },
    "message-editor textarea::placeholder": {
      WebkitTextFillColor: "var(--muted-foreground) !important"
    },
    ".keating-header": {
      background: "var(--background)",
      backdropFilter: "blur(10px)",
      borderBottom: "2px solid var(--border)",
      padding: "0.75rem 1rem"
    },
    ".dark .keating-header": {
      background: "var(--background)",
      borderBottom: "2px solid var(--border)"
    },
    ".local-model-badge": {
      background: "var(--color-primary)",
      color: "white",
      fontSize: "0.75rem",
      padding: "0.25rem 0.5rem",
      borderRadius: "9999px"
    },
    ".no-scrollbar::-webkit-scrollbar": {
      display: "none"
    },
    ".no-scrollbar": {
      MsOverflowStyle: "none",
      scrollbarWidth: "none"
    },
    ".markdown-content h1,\n.markdown-content h2,\n.markdown-content h3,\n.markdown-content h4,\n.markdown-content h5,\n.markdown-content h6": {
      color: "var(--foreground)"
    },
    ".markdown-content .katex": {
      color: "var(--foreground)"
    },
    ".markdown-content code:not(.hljs)": {
      color: "var(--foreground)"
    },
    ".dark .chat-page-shell": {
      "--chat-paper": "var(--terminal)",
      "--chat-ink": "var(--ink)",
      "--chat-accent": "var(--primary)"
    },
    ".chat-page-shell .chat-header": {
      background: "var(--chat-paper)",
      borderBottom: "2px solid var(--chat-ink)"
    },
    ".dark .chat-page-shell .chat-header": {
      background: "var(--chat-paper)",
      borderBottom: "2px solid var(--chat-ink)"
    },
    ".chat-page-shell .composer-root": {
      background: "var(--chat-paper)",
      border: "2px solid var(--chat-ink)",
      boxShadow: "4px 4px 0 var(--chat-ink)",
      transition: "box-shadow 0.15s,\n    transform 0.15s",
      borderRadius: "0"
    },
    ".chat-page-shell .composer-root:focus-within": {
      boxShadow: "2px 2px 0 var(--chat-ink)"
    },
    ".chat-page-shell.session-forking .chat-page-panel": {
      animation: "session-fork-pulse 560ms ease-out"
    },
    ".session-fork-arrive": {
      animation: "session-fork-arrive 900ms ease-out"
    },
    ".dark .chat-page-shell .composer-root": {
      background: "var(--chat-paper)",
      borderColor: "rgba(75, 227, 136, 0.3)",
      boxShadow: "4px 4px 0 rgba(75, 227, 136, 0.15)"
    },
    ".dark .chat-page-shell .composer-root:focus-within": {
      boxShadow: "2px 2px 0 rgba(75, 227, 136, 0.2)"
    },
    ".chat-persistence-banner": {
      background: "var(--amber)",
      color: "var(--ink)"
    },
    ".dark .chat-persistence-banner": {
      background: "#c98a2e",
      color: "var(--terminal)"
    },
    ".chat-persistence-track": {
      display: "flex",
      width: "max-content",
      gap: "2rem",
      whiteSpace: "nowrap",
      animation: "chat-persistence-scroll 18s linear infinite"
    },
    ".session-card-hero-svg > svg": {
      width: "100%",
      height: "100%",
      maxHeight: "100%",
      objectFit: "contain"
    },
    ".artifact-browser-overlay": {
      borderLeft: "2px solid var(--border)",
      boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.15)"
    },
    ".dark .artifact-browser-overlay": {
      borderLeft: "2px solid rgba(75, 227, 136, 0.2)"
    },
    "::-webkit-scrollbar": {
      width: "8px",
      height: "8px"
    },
    "::-webkit-scrollbar-track": {
      background: "transparent"
    },
    "::-webkit-scrollbar-thumb": {
      background: "var(--border)",
      borderRadius: "0"
    },
    ".dark ::-webkit-scrollbar-thumb": {
      background: "rgba(75, 227, 136, 0.2)"
    },
    "[data-webmcp-widget]": {
      display: "none !important"
    },
    ".chat-page-shell .chat-avatar": {
      width: "38px",
      height: "38px",
      flexShrink: "0",
      border: "1.5px solid var(--chat-ink)",
      background: "var(--card)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "2px 2px 0 var(--chat-ink)",
      overflow: "hidden"
    },
    ".chat-page-shell .chat-avatar > img": {
			width: "34px",
			height: "auto"
		},
		".keating-mascot-image": {
			objectFit: "contain",
			filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.16))"
		},
		".dark .keating-mascot-image": {
			filter: "drop-shadow(0 1px 1px rgba(255, 255, 255, 0.2)) drop-shadow(0 3px 5px rgba(0, 0, 0, 0.4))"
		},
		".live-mascot-frame": {
			transformOrigin: "50% 78%",
			transition: "opacity 200ms cubic-bezier(0.25, 1, 0.5, 1)",
			willChange: "transform, opacity",
			opacity: 0
		},
		".live-mascot-frame.is-active": {
			opacity: 1
		},
		".live-mascot-connecting.is-active": {
			animation: "keating-live-connect 2.6s ease-in-out infinite"
		},
		".live-mascot-idle.is-active": {
			animation: "keating-live-idle 4.8s ease-in-out infinite"
		},
		".live-mascot-listening.is-active": {
			animation: "keating-live-listen 1.15s ease-in-out infinite"
		},
		".live-mascot-speaking.is-active": {
			animation: "keating-live-speak 680ms cubic-bezier(0.25, 1, 0.5, 1) infinite"
		},
		".live-mascot-working.is-active": {
			animation: "keating-live-work 1.5s cubic-bezier(0.25, 1, 0.5, 1) infinite"
		},
		".keating-static-mascot": {
			animation: "keating-live-idle 4.8s ease-in-out infinite",
			transformOrigin: "50% 78%"
		},
		".keating-thinking-mascot img": {
			animation: "keating-mascot-think 1.8s ease-in-out infinite",
			transformOrigin: "50% 80%"
		},
		".keating-thinking-dot": {
			display: "inline-block",
			width: "4px",
			height: "4px",
			borderRadius: "9999px",
			background: "var(--primary)",
			animation: "keating-thinking-dot 1.1s ease-in-out infinite"
		},
    ".chat-page-shell .chat-avatar-you": {
      background: "var(--green-wash)",
      color: "var(--green-deep)"
    },
    ".dark .chat-page-shell .chat-avatar-you": {
      background: "rgba(75, 227, 136, 0.12)",
      color: "var(--phosphor)"
    },
    ".chat-page-shell .chat-avatar-you > img": {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    },
    ".chat-page-shell .msg-meta": {
      fontFamily: "var(--mono-body)",
      fontSize: "10px",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      marginBottom: "6px"
    },
    ".chat-page-shell .msg-meta b": {
      color: "var(--green-deep)",
      fontWeight: "600"
    },
    ".dark .chat-page-shell .msg-meta b": {
      color: "var(--phosphor)"
    },
    ".chat-page-shell .keating-bubble": {
      position: "relative",
      background: "transparent",
      border: "0",
      boxShadow: "none",
      padding: "0",
      overflow: "visible"
    },
    ".dark .chat-page-shell .keating-bubble": {
      background: "transparent",
      borderColor: "transparent",
      boxShadow: "none"
    },
    ".dark .chat-page-shell .keating-bubble::after": {
      content: "none"
    },
    ".chat-page-shell .you-bubble": {
      background: "var(--card)",
      border: "1.5px solid var(--chat-ink)",
      boxShadow: "3px 3px 0 var(--chat-ink)",
      padding: "10px 14px"
    },
    ".dark .chat-page-shell .you-bubble": {
      borderColor: "rgba(75, 227, 136, 0.3)",
      boxShadow: "3px 3px 0 rgba(75, 227, 136, 0.15)"
    },
    ".chat-page-shell .chat-mode-badge": {
      fontFamily: "var(--mono-body)",
      fontSize: "10px",
      letterSpacing: "0.1em",
      padding: "5px 10px",
      border: "1px solid var(--green)",
      color: "var(--green-deep)",
      background: "var(--card)",
      whiteSpace: "nowrap",
      alignItems: "center"
    },
    ".dark .chat-page-shell .chat-mode-badge": {
      borderColor: "rgba(75, 227, 136, 0.45)",
      color: "var(--phosphor)"
    },
    ".chat-page-shell .composer-hint": {
      fontFamily: "var(--mono-body)",
      fontSize: "10px",
      letterSpacing: "0.08em",
      color: "var(--muted-foreground)"
    },
    ".chat-page-shell .composer-hint .ok": {
      color: "var(--green-deep)"
    },
    ".dark .chat-page-shell .composer-hint .ok": {
      color: "var(--phosphor)"
    },
    ".chat-page-shell .session-sidebar": {
      background: "var(--sidebar)"
    },
    ".chat-page-shell .session-sidebar li > div": {
      borderRadius: "0"
    },
    ".chat-page-shell .session-sidebar .sb-new": {
      borderRadius: "0",
      background: "var(--green)",
      color: "var(--primary-foreground)",
      border: "1.5px solid var(--green-deep)",
      boxShadow: "3px 3px 0 var(--green-deep)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontSize: "12px",
      transition: "transform 0.12s,\n    box-shadow 0.12s"
    },
    ".chat-page-shell .session-sidebar .sb-new:hover": {
      transform: "translate(-1px, -1px)",
      boxShadow: "4px 4px 0 var(--green-deep)",
      background: "var(--green)"
    },
    ".chat-page-shell .session-sidebar .sb-new:active": {
      transform: "translate(2px, 2px)",
      boxShadow: "1px 1px 0 var(--green-deep)"
    },
    ".dark .chat-page-shell .session-sidebar .sb-new": {
      background: "var(--phosphor)",
      color: "var(--crt)"
    },
    ".chat-page-shell .sb-foot": {
      position: "relative",
      flexShrink: "0",
      borderTop: "1.5px solid var(--chat-ink)",
      background: "var(--crt)",
      padding: "11px 16px",
      overflow: "hidden"
    },
    ".chat-page-shell .sb-foot::after": {
      content: "\"\"",
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "repeating-linear-gradient(\n    0deg,\n    rgba(0, 0, 0, 0.18) 0 1px,\n    transparent 1px 3px\n  )"
    },
    ".chat-page-shell .sb-foot > div": {
      fontFamily: "var(--mono-body)",
      fontSize: "10.5px",
      letterSpacing: "0.1em",
      color: "var(--phosphor-dim)",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      lineHeight: "2"
    },
    ".chat-page-shell .sb-foot b": {
      color: "var(--phosphor)",
      fontWeight: "600"
    },
    ".chat-page-shell .sb-dot": {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: "var(--green)",
      flexShrink: "0",
      animation: "chat-pulse-ring 2.4s infinite"
    },
    ".flashcard-stage": {
      perspective: "1200px",
      touchAction: "pan-y"
    },
    ".flashcard-3d": {
      display: "grid",
      position: "relative",
      transformStyle: "preserve-3d",
      transition: "transform 320ms cubic-bezier(0.4, 0.2, 0.2, 1)",
      willChange: "transform"
    },
    ".flashcard-3d.flashcard-flipped": {
      transform: "rotateY(180deg)"
    },
    ".flashcard-3d.flashcard-dragging": {
      transition: "none"
    },
    ".flashcard-face": {
      gridArea: "1 / 1",
      minWidth: "0",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      transform: "rotateY(0deg)",
      transition: "opacity 120ms ease-out"
    },
    ".flashcard-face-back": {
      transform: "rotateY(180deg)"
    },
    ".flashcard-3d:not(.flashcard-flipped) .flashcard-face-back,\n.flashcard-3d.flashcard-flipped .flashcard-face:not(.flashcard-face-back)": {
      opacity: "0",
      pointerEvents: "none"
    },
    ".flashcard-exit-left": {
      animation: "flashcard-exit-left 200ms ease-in forwards"
    },
    ".flashcard-exit-right": {
      animation: "flashcard-exit-right 200ms ease-in forwards"
    },
    ".flashcard-exit-up": {
      animation: "flashcard-exit-up 200ms ease-in forwards"
    },
    ".flashcard-exit-down": {
      animation: "flashcard-exit-down 200ms ease-in forwards"
    },
    ".flashcard-exit-fade": {
      animation: "flashcard-exit-fade 170ms ease-in forwards"
    },
    ".flashcard-enter": {
      animation: "flashcard-enter 200ms ease-out"
    },
    ".flashcard-streak-pop": {
      animation: "flashcard-streak-pop 320ms ease-out"
    },
    ".flashcard-milestone-pulse": {
      animation: "flashcard-milestone-pulse 650ms ease-out 2"
    },
    ".dialog-compact-button": {
      width: "auto !important"
    },
    ".dialog-icon-button": {
      width: "auto !important"
    },
    "[class~=\"dialog-compact-button\"]": {
      width: "auto !important"
    },
    "[class~=\"dialog-icon-button\"]": {
      width: "auto !important"
    },
    "[role=\"dialog\"] button": {
      width: "auto !important"
    },
    ".retro-layout": {
      "--nav-height": "3.5rem",
      fontFamily: "var(--mono-body)",
      backgroundColor: "var(--paper)",
      color: "var(--ink)",
      lineHeight: "1.65",
      WebkitFontSmoothing: "antialiased"
    },
    ".dark .retro-layout.retro-page::before": {
      opacity: "0.02"
    },
    ".retro-layout.retro-page::before": {
      content: "''",
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
      opacity: "0.04",
      pointerEvents: "none",
      zIndex: "1"
    },
    ".retro-layout .font-terminal": {
      fontFamily: "'VT323', monospace"
    },
    ".retro-layout .keating-title": {
      fontFamily: "'VT323', monospace",
      fontSize: "48px",
      color: "var(--accent)"
    },
    ".retro-layout .nav-link": {
      color: "var(--ink)",
      textDecoration: "none",
      transition: "color 0.15s, text-shadow 0.15s",
      cursor: "pointer",
      position: "relative"
    },
    ".retro-layout .nav-link:hover": {
      color: "var(--accent)"
    },
    ".retro-layout .nav-logo": {
      border: "2px solid transparent",
      borderRadius: "0.375rem",
      padding: "0.25rem 0.375rem",
      transition: "background-color 0.15s ease,\n    border-color 0.15s ease,\n    color 0.15s ease,\n    transform 0.15s ease,\n    box-shadow 0.15s ease"
    },
    ".retro-layout .nav-logo img": {
      transition: "transform 0.15s ease,\n    filter 0.15s ease"
    },
    ".retro-layout .nav-logo:hover,\n.retro-layout .nav-logo:focus-visible": {
      borderColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
      background: "color-mix(in srgb, var(--accent) 12%, transparent)",
      color: "var(--accent)",
      boxShadow: "2px 2px 0 color-mix(in srgb, var(--accent) 55%, transparent)",
      transform: "translateY(-1px)"
    },
    ".retro-layout .nav-logo:hover img,\n.retro-layout .nav-logo:focus-visible img": {
      filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 55%, transparent))",
      transform: "rotate(-3deg) scale(1.06)"
    },
    ".retro-layout .nav-logo:active": {
      boxShadow: "1px 1px 0 color-mix(in srgb, var(--accent) 55%, transparent)",
      transform: "translate(1px, 1px)"
    },
    ".retro-layout .glitch-hover": {
      position: "relative",
      transition: "color 0.1s, text-shadow 0.1s"
    },
    ".retro-layout .glitch-hover:hover": {
      color: "var(--accent)",
      textShadow: "2px 0 var(--phosphor), -2px 0 var(--accent)",
      animation: "retro-glitch 0.3s steps(3, end) infinite"
    },
    ".retro-layout .prompt::before": {
      content: "'$ '",
      color: "var(--accent)"
    },
    ".retro-layout .crt::before": {
      content: "''",
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      background: "repeating-linear-gradient(0deg,\n      rgba(0, 0, 0, 0.03),\n      rgba(0, 0, 0, 0.03) 1px,\n      transparent 1px,\n      transparent 2px)",
      pointerEvents: "none",
      animation: "retro-scanlines 0.1s linear infinite"
    },
    ".retro-layout .cursor-blink::after": {
      content: "'_'",
      animation: "retro-blink 1s step-end infinite",
      color: "var(--accent)"
    },
    ".retro-layout .terminal-glow": {
      boxShadow: "0 0 20px rgba(75, 227, 136, 0.25), inset 0 0 20px rgba(75, 227, 136, 0.05)"
    },
    ".retro-layout .typewriter": {
      overflow: "hidden",
      whiteSpace: "nowrap",
      animation: "retro-typing 3.5s steps(40, end)"
    },
    ".retro-layout .boot-line": {
      opacity: "0",
      animation: "retro-boot-line 0.1s ease forwards"
    },
    ".retro-layout .terminal-window": {
      background: "var(--terminal)",
      color: "var(--phosphor)",
      fontFamily: "'VT323', monospace",
      position: "relative",
      overflowWrap: "break-word",
      wordBreak: "break-word"
    },
    ".retro-layout .terminal-window::before": {
      content: "''",
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      background: "repeating-linear-gradient(0deg,\n      rgba(75, 227, 136, 0.04),\n      rgba(75, 227, 136, 0.04) 1px,\n      transparent 1px,\n      transparent 2px)",
      pointerEvents: "none"
    },
    ".retro-layout .tape": {
      position: "relative"
    },
    ".retro-layout .tape::before": {
      content: "''",
      position: "absolute",
      top: "-10px",
      left: "50%",
      transform: "translateX(-50%) rotate(-2deg)",
      width: "80px",
      height: "25px",
      background: "rgba(255, 255, 255, 0.4)",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)"
    },
    ".retro-layout .stamp": {
      border: "3px solid var(--accent)",
      color: "var(--accent)",
      padding: "4px 12px",
      transform: "rotate(-5deg)",
      display: "inline-block",
      fontWeight: "bold",
      letterSpacing: "2px",
      textTransform: "uppercase",
      opacity: "0.8"
    },
    ".retro-layout .marquee": {
      overflow: "hidden",
      whiteSpace: "nowrap"
    },
    ".retro-layout .marquee span": {
      display: "inline-block",
      animation: "retro-marquee 20s linear infinite"
    },
    ".retro-layout .coords": {
      fontFamily: "'VT323', monospace",
      fontSize: "12px",
      color: "var(--accent)",
      opacity: "0.5"
    },
    ".retro-layout .install-tab": {
      fontFamily: "'VT323', monospace",
      cursor: "pointer",
      transition: "all 0.2s"
    },
    ".retro-layout .install-tab:hover": {
      transform: "translateY(-1px)"
    },
    ".retro-layout .install-tab.active": {
      boxShadow: "2px 2px 0 var(--ink)"
    },
    ".retro-layout .copy-btn": {
      fontFamily: "'VT323', monospace",
      cursor: "pointer",
      transition: "all 0.2s"
    },
    ".retro-layout .copy-btn:hover": {
      background: "rgba(75, 227, 136, 0.2)"
    },
    ".retro-layout .post-card": {
      transition: "all 0.2s ease"
    },
    ".retro-layout .post-card:hover": {
      transform: "translateY(-2px)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)"
    },
    ".retro-layout .tutorial-topic-card": {
      cursor: "pointer",
      boxShadow: "0 0 0 rgba(0, 0, 0, 0)",
      transition: "background-color 0.15s ease,\n    border-color 0.15s ease,\n    color 0.15s ease,\n    transform 0.15s ease,\n    box-shadow 0.15s ease"
    },
    ".retro-layout .tutorial-topic-card:hover,\n.retro-layout .tutorial-topic-card:focus-visible": {
      borderColor: "var(--accent)",
      background: "color-mix(in srgb, var(--accent) 10%, var(--paper))",
      boxShadow: "3px 3px 0 var(--ink)",
      transform: "translate(-1px, -1px)"
    },
    ".dark .retro-layout .tutorial-topic-card:hover,\n.dark .retro-layout .tutorial-topic-card:focus-visible": {
      boxShadow: "3px 3px 0 color-mix(in srgb, var(--accent) 45%, transparent)"
    },
    ".retro-layout .tutorial-topic-card:active": {
      boxShadow: "1px 1px 0 var(--ink)",
      transform: "translate(1px, 1px)"
    },
    ".retro-layout .code-block": {
      background: "var(--terminal)",
      color: "#dcefe0",
      padding: "1rem",
      fontSize: "0.85rem",
      overflowX: "auto",
      fontFamily: "'Space Mono', monospace"
    },
    ".retro-layout .code-block pre": {
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-word"
    },
    ".retro-layout .tab-btn": {
      transition: "all 0.2s",
      fontFamily: "'VT323', monospace",
      cursor: "pointer"
    },
    ".retro-layout .tab-btn.active": {
      background: "var(--ink)",
      color: "var(--paper)"
    },
    ".bg-paper": {
      backgroundColor: "var(--paper)"
    },
    ".bg-ink": {
      backgroundColor: "var(--ink)"
    },
    ".text-paper": {
      color: "var(--paper)"
    },
    ".text-ink": {
      color: "var(--ink)"
    },
    ".border-ink": {
      borderColor: "var(--ink)"
    },
    ".text-accent": {
      color: "var(--accent)"
    },
    ".border-paper-20": {
      borderColor: "rgba(241, 236, 224, 0.2)"
    },
    ".text-paper-60": {
      color: "rgba(241, 236, 224, 0.6)"
    },
    ".text-paper-80": {
      color: "rgba(241, 236, 224, 0.8)"
    },
    ".bg-paper-95": {
      backgroundColor: "var(--paper)"
    },
    ".border-green-30": {
      borderColor: "rgba(75, 227, 136, 0.3)"
    },
    ".border-green-50": {
      borderColor: "rgba(75, 227, 136, 0.5)"
    },
    ".bg-green-30": {
      backgroundColor: "rgba(75, 227, 136, 0.3)"
    },
    ".bg-ink-20": {
      backgroundColor: "rgba(28, 33, 27, 0.2)"
    },
    ".retro-layout .wrap": {
      maxWidth: "1180px",
      margin: "0 auto",
      padding: "0 28px"
    },
    ".retro-layout .hero": {
      padding: "64px 0 88px",
      position: "relative",
      overflow: "hidden"
    },
    ".retro-layout .hero-coords": {
      marginBottom: "34px",
      fontSize: "10px",
      letterSpacing: "0.22em",
      color: "var(--ink-soft)",
      opacity: "0.75"
    },
    ".retro-layout .hero-wrap": {
      display: "grid"
    },
    ".retro-layout .hero-grid": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 46fr) minmax(0, 54fr)",
      gap: "48px",
      alignItems: "start"
    },
    ".retro-layout .hero-content": {
      minWidth: "0"
    },
    ".retro-layout .hero h1": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "clamp(34px, 4.6vw, 56px)",
      lineHeight: "1.08",
      letterSpacing: "-0.015em",
      margin: "18px 0 10px"
    },
    ".retro-layout .hero-brand": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "clamp(52px, 7.2vw, 96px)",
      lineHeight: "0.95",
      letterSpacing: "-0.03em",
      color: "var(--accent-dim)",
      margin: "16px 0 6px"
    },
    ".dark .retro-layout .hero-brand": {
      color: "var(--phosphor)",
      textShadow: "0 0 26px rgba(75, 227, 136, 0.35)"
    },
    ".retro-layout .hero-brand-suffix": {
      fontSize: "0.38em",
      fontWeight: "700",
      letterSpacing: "0",
      color: "var(--ink-soft)"
    },
    ".retro-layout .hero-headline": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "clamp(20px, 2.4vw, 30px)",
      lineHeight: "1.2",
      letterSpacing: "-0.015em",
      margin: "0 0 10px"
    },
    ".retro-layout .hero-headline .cursor": {
      display: "inline-block",
      width: "0.55em",
      height: "0.09em",
      background: "var(--accent)",
      verticalAlign: "baseline",
      marginLeft: "6px",
      animation: "retro-cursor-blink 1.1s steps(1) infinite"
    },
    ".retro-layout .hero h1 .cursor": {
      display: "inline-block",
      width: "0.55em",
      height: "0.09em",
      background: "var(--accent)",
      verticalAlign: "baseline",
      marginLeft: "6px",
      animation: "retro-cursor-blink 1.1s steps(1) infinite"
    },
    ".retro-layout .hero-sub": {
      fontFamily: "var(--mono-display)",
      color: "var(--accent-dim)",
      fontWeight: "700",
      fontSize: "clamp(15px, 1.6vw, 19px)",
      letterSpacing: "0.06em",
      marginBottom: "22px"
    },
    ".dark .retro-layout .hero-sub": {
      color: "var(--phosphor)"
    },
    ".retro-layout .hero-copy": {
      color: "var(--ink-soft)",
      maxWidth: "46ch",
      marginBottom: "34px"
    },
    ".retro-layout .hero-copy strong": {
      color: "var(--ink)",
      fontWeight: "600"
    },
    ".retro-layout .hero-ctas": {
      display: "flex",
      gap: "16px",
      flexWrap: "wrap",
      marginBottom: "30px"
    },
    ".retro-layout .hero-ctas .keating-btn-retro": {
      fontSize: "13px",
      padding: "0.5rem",
      textDecoration: "none"
    },
    ".retro-layout .hero-stage": {
      position: "relative",
      display: "grid",
      justifyItems: "center",
      alignContent: "start",
      minHeight: "0"
    },
    ".retro-layout .term-3d": {
      position: "relative",
      zIndex: "3",
      width: "100%",
      aspectRatio: "1.18",
      height: "auto",
      minHeight: "420px",
      maxHeight: "520px"
    },
    ".retro-layout .term-3d canvas": {
      width: "100% !important",
      height: "100% !important"
    },
    ".retro-layout .term": {
      position: "relative",
      zIndex: "1",
      background: "var(--terminal)",
      border: "1.5px solid var(--ink)",
      boxShadow: "6px 6px 0 var(--ink)"
    },
    ".retro-layout .term-bar": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "11px 14px",
      background: "var(--terminal-edge)",
      borderBottom: "1px solid rgba(75, 227, 136, 0.18)"
    },
    ".retro-layout .term-bar .d": {
      width: "11px",
      height: "11px",
      borderRadius: "50%"
    },
    ".retro-layout .term-bar .d.r": {
      background: "var(--red)"
    },
    ".retro-layout .term-bar .d.y": {
      background: "var(--amber)"
    },
    ".retro-layout .term-bar .d.g": {
      background: "var(--accent)"
    },
    ".retro-layout .term-title": {
      marginLeft: "8px",
      fontSize: "11px",
      letterSpacing: "0.14em",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .term-body": {
      position: "relative",
      padding: "22px 24px 26px",
      minHeight: "380px",
      fontSize: "13.5px",
      lineHeight: "1.85",
      color: "var(--phosphor)"
    },
    ".retro-layout .term-body::after": {
      content: "''",
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px)",
      mixBlendMode: "multiply"
    },
    ".retro-layout .t-line": {
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      minHeight: "1.85em"
    },
    ".retro-layout .t-cmd": {
      color: "#dcefe0"
    },
    ".retro-layout .t-cmd::before": {
      content: "'keating@harness:~$ '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .t-sys": {
      color: "var(--phosphor-dim)",
      fontStyle: "italic"
    },
    ".retro-layout .t-you": {
      color: "var(--amber)"
    },
    ".retro-layout .t-you::before": {
      content: "'you      │ '",
      color: "rgba(232, 163, 61, 0.55)"
    },
    ".retro-layout .t-k": {
      color: "var(--phosphor)"
    },
    ".retro-layout .t-k::before": {
      content: "'keating  │ '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .t-ok": {
      color: "var(--phosphor)",
      fontWeight: "600"
    },
    ".retro-layout .t-ok::before": {
      content: "'✓ '",
      color: "var(--accent)"
    },
    ".retro-layout .t-caret": {
      display: "inline-block",
      width: "8px",
      height: "15px",
      background: "var(--phosphor)",
      verticalAlign: "-2px",
      animation: "retro-cursor-blink 1s steps(1) infinite"
    },
    ".retro-layout .term-foot": {
      display: "flex",
      gap: "0",
      borderTop: "1.5px solid var(--ink)",
      background: "var(--card)",
      fontSize: "11px",
      letterSpacing: "0.1em"
    },
    ".retro-layout .term-foot div": {
      padding: "9px 14px",
      borderRight: "1px solid var(--line)",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    ".retro-layout .term-foot div:last-child": {
      borderRight: "none",
      marginLeft: "auto"
    },
    ".retro-layout .term-foot .dot": {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: "var(--accent)"
    },
    ".retro-layout .caps": {
      padding: "84px 0 90px",
      borderTop: "1.5px dashed var(--line)"
    },
    ".retro-layout .caps-head": {
      marginBottom: "38px"
    },
    ".retro-layout .caps-head .keating-section-title": {
      marginTop: "14px"
    },
    ".retro-layout .caps-grid": {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "18px"
    },
    ".retro-layout .verse": {
      padding: "30px 0 96px",
      textAlign: "center",
      background: "radial-gradient(ellipse 60% 55% at 50% 62%, rgba(75, 227, 136, 0.12), transparent 70%)"
    },
    ".retro-layout .verse-prompt": {
      fontSize: "11px",
      letterSpacing: "0.2em",
      color: "var(--ink-soft)",
      marginBottom: "30px"
    },
    ".retro-layout .crt-wrap": {
      position: "relative",
      maxWidth: "620px",
      margin: "0 auto",
      transition: "transform 0.3s ease"
    },
    ".retro-layout .crt-wrap:hover": {
      transform: "scale(1.015)"
    },
    ".retro-layout .crt-wrap > img": {
      width: "100%",
      height: "auto",
      filter: "drop-shadow(0 26px 32px rgba(28, 33, 27, 0.3))"
    },
    ".retro-layout .crt-screen": {
      position: "absolute",
      left: "11.5%",
      top: "19%",
      width: "70.5%",
      height: "54%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "5% 6%",
      overflow: "hidden"
    },
    ".retro-layout .crt-screen::after": {
      content: "''",
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0 1px, transparent 1px 3px)"
    },
    ".retro-layout .crt-text": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontStyle: "italic",
      fontSize: "clamp(13px, 2.5vw, 19px)",
      lineHeight: "1.55",
      color: "var(--phosphor)",
      textShadow: "0 0 14px rgba(75, 227, 136, 0.6), 0 0 36px rgba(75, 227, 136, 0.3)",
      animation: "retro-flicker 6s linear infinite",
      position: "relative",
      zIndex: "1"
    },
    ".retro-layout .crt-attr": {
      position: "relative",
      zIndex: "1",
      marginTop: "10px",
      fontSize: "clamp(8px, 1.4vw, 11px)",
      letterSpacing: "0.18em",
      color: "var(--phosphor-dim)",
      animation: "retro-flicker 6s linear infinite"
    },
    ".retro-layout .manifesto": {
      padding: "90px 0",
      position: "relative"
    },
    ".retro-layout .man-grid": {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: "22px",
      position: "relative"
    },
    ".retro-layout .man-card": {
      background: "var(--card)",
      border: "1.5px solid var(--ink)",
      padding: "26px 26px 28px",
      boxShadow: "var(--shadow-card)",
      transition: "transform 0.14s ease, box-shadow 0.14s ease"
    },
    ".retro-layout .man-card:hover": {
      transform: "translateY(-3px)",
      boxShadow: "5px 5px 0 var(--ink)"
    },
    ".retro-layout .man-num": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "15px",
      color: "var(--accent-dim)",
      letterSpacing: "0.04em",
      marginBottom: "8px"
    },
    ".dark .retro-layout .man-num": {
      color: "var(--phosphor)"
    },
    ".retro-layout .man-card h3": {
      fontFamily: "var(--mono-display)",
      fontSize: "19px",
      marginBottom: "10px",
      letterSpacing: "0.02em"
    },
    ".retro-layout .man-card p": {
      color: "var(--ink-soft)",
      fontSize: "14px"
    },
    ".retro-layout .man-card p strong": {
      color: "var(--ink)",
      fontWeight: "600"
    },
    ".retro-layout .man-stamp": {
      position: "absolute",
      right: "-8px",
      top: "-46px",
      zIndex: "4",
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: "0.22em",
      color: "var(--accent)",
      border: "2.5px dashed var(--accent)",
      padding: "10px 18px",
      background: "color-mix(in srgb, var(--paper) 85%, transparent)",
      transform: "rotate(-6deg)",
      textTransform: "uppercase"
    },
    ".retro-layout .use": {
      padding: "90px 0",
      borderTop: "1.5px dashed var(--line)"
    },
    ".retro-layout .use-grid": {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "18px",
      marginBottom: "38px"
    },
    ".retro-layout .use-card": {
      background: "var(--card)",
      border: "1.5px solid var(--ink)",
      padding: "24px 22px 26px",
      boxShadow: "var(--shadow-card)",
      transition: "transform 0.16s ease, box-shadow 0.16s ease"
    },
    ".retro-layout .use-card:hover": {
      transform: "translateY(-4px)",
      boxShadow: "5px 5px 0 var(--ink)"
    },
    ".retro-layout .use-card-title": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "15.5px",
      letterSpacing: "0.06em",
      color: "var(--accent-dim)",
      marginBottom: "6px"
    },
    ".dark .retro-layout .use-card-title": {
      color: "var(--phosphor)"
    },
    ".retro-layout .use-card-blurb": {
      color: "var(--ink-soft)",
      fontSize: "12.5px",
      lineHeight: "1.6",
      marginBottom: "14px"
    },
    ".retro-layout .use-cmds": {
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    },
    ".retro-layout .use-cmd": {
      display: "flex",
      flexDirection: "column",
      gap: "2px"
    },
    ".retro-layout .use-cmd code": {
      fontFamily: "var(--mono-body)",
      fontSize: "12.5px",
      color: "var(--ink)"
    },
    ".retro-layout .use-cmd code span": {
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .use-cmd code span": {
      color: "var(--phosphor)"
    },
    ".retro-layout .use-cmd small": {
      fontSize: "11.5px",
      color: "var(--ink-soft)"
    },
    ".retro-layout .use-links": {
      display: "flex",
      gap: "16px",
      flexWrap: "wrap"
    },
    ".retro-layout .install": {
      padding: "90px 0",
      borderTop: "1.5px dashed var(--line)"
    },
    ".retro-layout .install-term": {
      position: "relative",
      background: "var(--terminal)",
      border: "1.5px solid var(--ink)",
      boxShadow: "6px 6px 0 var(--ink)",
      maxWidth: "720px"
    },
    ".retro-layout .install-term-bar": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "11px 14px",
      background: "var(--terminal-edge)",
      borderBottom: "1px solid rgba(75, 227, 136, 0.18)"
    },
    ".retro-layout .install-term-bar .d": {
      width: "11px",
      height: "11px",
      borderRadius: "50%"
    },
    ".retro-layout .install-term-bar .d.r": {
      background: "var(--red)"
    },
    ".retro-layout .install-term-bar .d.y": {
      background: "var(--amber)"
    },
    ".retro-layout .install-term-bar .d.g": {
      background: "var(--accent)"
    },
    ".retro-layout .install-term-title": {
      marginLeft: "8px",
      fontSize: "11px",
      letterSpacing: "0.14em",
      color: "var(--phosphor-dim)",
      flex: "1"
    },
    ".retro-layout .install-copy": {
      fontFamily: "var(--mono-body)",
      fontSize: "11px",
      letterSpacing: "0.1em",
      padding: "5px 10px",
      border: "1px solid rgba(75, 227, 136, 0.45)",
      color: "var(--phosphor)",
      background: "transparent",
      cursor: "pointer",
      transition: "background 0.15s, color 0.15s"
    },
    ".retro-layout .install-copy:hover": {
      background: "rgba(75, 227, 136, 0.12)"
    },
    ".retro-layout .install-copy.copied": {
      background: "rgba(75, 227, 136, 0.25)",
      color: "var(--phosphor)"
    },
    ".retro-layout .install-term-tabs": {
      display: "flex",
      gap: "0",
      borderBottom: "1px solid rgba(75, 227, 136, 0.18)",
      background: "rgba(0, 0, 0, 0.25)",
      overflowX: "auto"
    },
    ".retro-layout .install-term-tabs button": {
      fontFamily: "var(--mono-body)",
      fontSize: "12px",
      letterSpacing: "0.06em",
      padding: "10px 16px",
      background: "transparent",
      border: "none",
      borderRight: "1px solid rgba(75, 227, 136, 0.12)",
      color: "var(--phosphor-dim)",
      cursor: "pointer",
      transition: "background 0.15s, color 0.15s",
      whiteSpace: "nowrap"
    },
    ".retro-layout .install-term-tabs button:hover": {
      background: "rgba(75, 227, 136, 0.08)",
      color: "var(--phosphor)"
    },
    ".retro-layout .install-term-tabs button.active": {
      background: "rgba(75, 227, 136, 0.14)",
      color: "var(--phosphor)"
    },
    ".retro-layout .install-term-body": {
      position: "relative",
      padding: "22px 24px 26px",
      fontSize: "13.5px",
      lineHeight: "1.85",
      color: "var(--phosphor)",
      minHeight: "120px"
    },
    ".retro-layout .install-term-body::after": {
      content: "''",
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px)",
      mixBlendMode: "multiply"
    },
    ".retro-layout .install-term-body .t-line": {
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      minHeight: "1.85em",
      position: "relative",
      zIndex: "1"
    },
    ".retro-layout .install-term-body .t-cmd::before": {
      content: "'$ '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .install-term-body .t-sys": {
      color: "var(--phosphor-dim)",
      fontStyle: "italic"
    },
    ".retro-layout .install-term-body .t-ok": {
      color: "var(--phosphor)",
      fontWeight: "600"
    },
    ".retro-layout .install-term-body .t-indent": {
      paddingLeft: "18px",
      color: "rgba(220, 239, 224, 0.8)"
    },
    ".retro-layout .final": {
      padding: "100px 0",
      textAlign: "center",
      background: "radial-gradient(ellipse 70% 60% at 50% 110%, var(--green-wash), transparent 70%)"
    },
    ".retro-layout .final img": {
      width: "96px",
      margin: "0 auto 26px",
      display: "block"
    },
    ".retro-layout .final .final-bot": {
      width: "300px",
      margin: "0 auto 22px",
      transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)"
    },
    ".retro-layout .final-bot:hover": {
      transform: "scale(1.06) rotate(3deg)"
    },
    ".retro-layout .final h2": {
      fontFamily: "var(--mono-display)",
      fontWeight: "700",
      fontSize: "clamp(28px, 4vw, 46px)",
      letterSpacing: "-0.01em",
      marginBottom: "14px"
    },
    ".retro-layout .final p": {
      color: "var(--ink-soft)",
      maxWidth: "52ch",
      margin: "0 auto 36px"
    },
    ".retro-layout .final .hero-ctas": {
      justifyContent: "center"
    },
    ".retro-layout .foot": {
      borderTop: "1.5px solid var(--ink)",
      background: "var(--paper-deep)",
      padding: "54px 0 30px"
    },
    ".retro-layout .foot-grid": {
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
      gap: "36px",
      marginBottom: "46px"
    },
    ".retro-layout .foot-brand img": {
      height: "64px",
      width: "auto",
      marginBottom: "16px"
    },
    ".retro-layout .foot-brand p": {
      fontSize: "12.5px",
      color: "var(--ink-soft)",
      maxWidth: "30ch"
    },
    ".retro-layout .foot-col h5": {
      fontSize: "11px",
      letterSpacing: "0.18em",
      color: "var(--accent-dim)",
      marginBottom: "14px",
      textTransform: "uppercase"
    },
    ".dark .retro-layout .foot-col h5": {
      color: "var(--phosphor)"
    },
    ".retro-layout .foot-col ul": {
      listStyle: "none",
      margin: "0",
      padding: "0"
    },
    ".retro-layout .foot-col a": {
      fontSize: "13px",
      textDecoration: "none",
      color: "var(--ink-soft)",
      display: "inline-block",
      padding: "4px 0",
      transition: "color 0.12s"
    },
    ".retro-layout .foot-col a:hover": {
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .foot-col a:hover": {
      color: "var(--phosphor)"
    },
    ".retro-layout .foot-base": {
      display: "flex",
      justifyContent: "space-between",
      gap: "16px",
      flexWrap: "wrap",
      borderTop: "1px solid var(--line-soft)",
      paddingTop: "22px",
      fontSize: "11px",
      letterSpacing: "0.08em",
      color: "var(--ink-soft)"
    },
    ".retro-layout .foot-base .ok": {
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .foot-base .ok": {
      color: "var(--phosphor)"
    },
    ".retro-layout .nav-version": {
      fontSize: "0.75rem",
      color: "var(--accent-dim)",
      letterSpacing: "0.1em",
      whiteSpace: "nowrap",
      alignSelf: "flex-end"
    },
    ".dark .retro-layout .nav-version": {
      color: "var(--phosphor)"
    },
    ".retro-layout .nav-status": {
      display: "none",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      letterSpacing: "0.1em",
      color: "var(--accent-dim)",
      border: "1px solid var(--line)",
      padding: "7px 12px",
      background: "var(--card)",
      whiteSpace: "nowrap"
    },
    ".dark .retro-layout .nav-status": {
      color: "var(--phosphor)"
    },
    ".retro-layout .nav-status .dot": {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: "var(--accent)",
      animation: "retro-pulse-ring 2.4s infinite"
    },
    ".nav-desktop": {
      display: "none !important"
    },
    ".nav-mobile-toggle": {
      display: "inline-flex"
    },
    ".nav-mobile-toggle:hover": {
      background: "var(--ink, #1c211b) !important",
      color: "var(--paper, #f1ece0) !important"
    },
    ".retro-layout .download-page": {
      position: "relative",
      zIndex: "2"
    },
    ".retro-layout .download-hero": {
      padding: "72px 0 84px",
      borderBottom: "1.5px dashed var(--line)"
    },
    ".retro-layout .download-hero-grid": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 420px)",
      gap: "54px",
      alignItems: "center"
    },
    ".retro-layout .download-hero h1": {
      fontFamily: "var(--mono-display)",
      fontSize: "clamp(38px, 5.4vw, 76px)",
      lineHeight: "0.98",
      letterSpacing: "-0.025em",
      maxWidth: "11ch",
      margin: "16px 0 24px",
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .download-hero h1": {
      color: "var(--phosphor)",
      textShadow: "0 0 24px rgba(75, 227, 136, 0.28)"
    },
    ".retro-layout .download-hero-copy": {
      color: "var(--ink-soft)",
      maxWidth: "62ch",
      marginBottom: "30px"
    },
    ".retro-layout .download-actions": {
      display: "flex",
      flexWrap: "wrap",
      gap: "16px",
      marginBottom: "18px"
    },
    ".retro-layout .download-actions .keating-btn-retro,\n.retro-layout .download-source-box .keating-btn-retro": {
      textDecoration: "none",
      fontSize: "12px"
    },
    ".retro-layout .download-note": {
      color: "var(--ink-soft)",
      fontSize: "12.5px",
      maxWidth: "58ch"
    },
    ".retro-layout .download-device-panel": {
      background: "var(--terminal)",
      border: "1.5px solid var(--ink)",
      boxShadow: "6px 6px 0 var(--ink)",
      color: "var(--phosphor)"
    },
    ".retro-layout .download-device-top": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "12px 14px",
      background: "var(--terminal-edge)",
      borderBottom: "1px solid rgba(75, 227, 136, 0.18)",
      fontSize: "11px",
      letterSpacing: "0.14em",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .download-device-top .d": {
      width: "11px",
      height: "11px",
      borderRadius: "50%"
    },
    ".retro-layout .download-device-top .d.r": {
      background: "var(--red)"
    },
    ".retro-layout .download-device-top .d.y": {
      background: "var(--amber)"
    },
    ".retro-layout .download-device-top .d.g": {
      background: "var(--accent)"
    },
    ".retro-layout .download-screen": {
      position: "relative",
      minHeight: "290px",
      padding: "28px",
      overflow: "hidden"
    },
    ".retro-layout .download-screen::after": {
      content: "''",
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px)",
      mixBlendMode: "multiply"
    },
    ".retro-layout .download-screen-line": {
      position: "relative",
      zIndex: "1",
      minHeight: "1.9em",
      color: "var(--phosphor)"
    },
    ".retro-layout .download-screen-line::before": {
      content: "'$ '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .download-screen-caret": {
      position: "relative",
      zIndex: "1",
      width: "9px",
      height: "17px",
      marginTop: "8px",
      background: "var(--phosphor)",
      animation: "retro-cursor-blink 1s steps(1) infinite"
    },
    ".retro-layout .download-section": {
      padding: "88px 0",
      borderBottom: "1.5px dashed var(--line)"
    },
    ".retro-layout .download-section-head": {
      marginBottom: "32px"
    },
    ".retro-layout .desktop-download-grid": {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "18px",
      marginBottom: "28px"
    },
    ".retro-layout .desktop-download-card": {
      background: "var(--card)",
      border: "1.5px solid var(--ink)",
      boxShadow: "var(--shadow-card)",
      padding: "24px"
    },
    ".retro-layout .desktop-platform": {
      fontFamily: "var(--mono-display)",
      color: "var(--accent-dim)",
      fontWeight: "700",
      marginBottom: "8px"
    },
    ".dark .retro-layout .desktop-platform": {
      color: "var(--phosphor)"
    },
    ".retro-layout .desktop-download-card p": {
      color: "var(--ink-soft)",
      fontSize: "12.8px",
      marginBottom: "16px"
    },
    ".retro-layout .desktop-download-card code": {
      display: "block",
      background: "var(--terminal)",
      color: "var(--phosphor)",
      padding: "10px 12px",
      fontSize: "12px",
      marginBottom: "14px",
      overflowX: "auto"
    },
    ".retro-layout .desktop-download-card a,\n.retro-layout .mobile-soon-card a": {
      color: "var(--accent-dim)",
      fontSize: "12.5px",
      fontWeight: "700"
    },
    ".dark .retro-layout .desktop-download-card a,\n.dark .retro-layout .mobile-soon-card a": {
      color: "var(--phosphor)"
    },
    ".retro-layout .download-source-box": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px) auto",
      gap: "24px",
      alignItems: "center",
      background: "color-mix(in srgb, var(--accent) 7%, var(--card))",
      border: "1.5px solid var(--ink)",
      padding: "24px",
      marginBottom: "28px"
    },
    ".retro-layout .download-source-box h3": {
      fontFamily: "var(--mono-display)",
      fontSize: "18px",
      marginBottom: "6px"
    },
    ".retro-layout .download-source-box p": {
      color: "var(--ink-soft)",
      fontSize: "13px"
    },
    ".retro-layout .download-command": {
      background: "var(--terminal)",
      color: "var(--phosphor)",
      padding: "14px 16px",
      fontSize: "12px"
    },
    ".retro-layout .download-command div::before": {
      content: "'$ '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .download-feature-list": {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "10px 22px",
      padding: "0",
      margin: "0",
      listStyle: "none"
    },
    ".retro-layout .download-feature-list li": {
      color: "var(--ink-soft)",
      fontSize: "13px"
    },
    ".retro-layout .download-feature-list li::before": {
      content: "'✓ '",
      color: "var(--accent-dim)",
      fontWeight: "700"
    },
    ".dark .retro-layout .download-feature-list li::before": {
      color: "var(--phosphor)"
    },
    ".retro-layout .mobile-coming-soon": {
      borderBottom: "0",
      background: "radial-gradient(ellipse 68% 72% at 84% 42%, var(--green-wash), transparent 64%)"
    },
    ".retro-layout .mobile-soon-grid": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 390px)",
      gap: "52px",
      alignItems: "center"
    },
    ".retro-layout .mobile-soon-card": {
      background: "var(--card)",
      border: "1.5px solid var(--ink)",
      boxShadow: "6px 6px 0 var(--ink)",
      padding: "24px"
    },
    ".retro-layout .mobile-badge": {
      display: "inline-flex",
      border: "2px dashed var(--accent)",
      color: "var(--accent-dim)",
      padding: "6px 12px",
      fontWeight: "700",
      letterSpacing: "0.16em",
      fontSize: "11px",
      transform: "rotate(-3deg)",
      marginBottom: "18px"
    },
    ".dark .retro-layout .mobile-badge": {
      color: "var(--phosphor)"
    },
    ".retro-layout .mobile-frame": {
      maxWidth: "210px",
      minHeight: "330px",
      margin: "0 auto 20px",
      border: "2px solid var(--ink)",
      borderRadius: "24px",
      background: "var(--terminal)",
      color: "var(--phosphor)",
      padding: "34px 18px 18px",
      position: "relative",
      boxShadow: "inset 0 0 0 5px var(--terminal-edge)"
    },
    ".retro-layout .mobile-notch": {
      position: "absolute",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "72px",
      height: "10px",
      borderRadius: "999px",
      background: "var(--terminal-edge)"
    },
    ".retro-layout .mobile-screen-line": {
      fontSize: "13px",
      marginBottom: "14px"
    },
    ".retro-layout .mobile-screen-line::before": {
      content: "'> '",
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .mobile-screen-line.dim": {
      color: "var(--phosphor-dim)"
    },
    ".retro-layout .mobile-soon-card p": {
      color: "var(--ink-soft)",
      fontSize: "12.8px",
      marginBottom: "12px"
    },
    ".retro-layout .download-recommend": {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      border: "1.5px solid var(--ink)",
      background: "color-mix(in srgb, var(--accent) 9%, var(--card))",
      padding: "12px 16px",
      marginBottom: "24px",
      maxWidth: "62ch"
    },
    ".retro-layout .download-recommend-logo": {
      display: "inline-flex",
      color: "var(--accent-dim)",
      flexShrink: "0"
    },
    ".dark .retro-layout .download-recommend-logo": {
      color: "var(--phosphor)"
    },
    ".retro-layout .download-recommend-text": {
      fontSize: "13px",
      color: "var(--ink-soft)",
      lineHeight: "1.55"
    },
    ".retro-layout .download-recommend-text strong": {
      color: "var(--ink)",
      fontWeight: "700"
    },
    ".retro-layout .btn-logo": {
      display: "inline-flex",
      alignItems: "center",
      marginRight: "2px"
    },
    ".retro-layout .desktop-card-head": {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "12px"
    },
    ".retro-layout .desktop-card-logo": {
      display: "inline-flex",
      color: "var(--ink)"
    },
    ".retro-layout .desktop-download-card.is-recommended": {
      borderColor: "var(--accent-dim)",
      boxShadow: "5px 5px 0 var(--accent-dim)",
      background: "color-mix(in srgb, var(--accent) 8%, var(--card))"
    },
    ".dark .retro-layout .desktop-download-card.is-recommended": {
      borderColor: "var(--accent)",
      boxShadow: "5px 5px 0 color-mix(in srgb, var(--accent) 45%, transparent)"
    },
    ".retro-layout .desktop-recommend-tag": {
      marginLeft: "auto",
      fontSize: "10px",
      letterSpacing: "0.14em",
      fontWeight: "700",
      color: "var(--accent-dim)",
      border: "1px solid var(--accent-dim)",
      padding: "3px 7px"
    },
    ".dark .retro-layout .desktop-recommend-tag": {
      color: "var(--phosphor)",
      borderColor: "color-mix(in srgb, var(--phosphor) 55%, transparent)"
    },
    ".retro-layout .mobile-platform-row": {
      display: "flex",
      flexWrap: "wrap",
      gap: "12px",
      marginTop: "22px"
    },
    ".retro-layout .mobile-platform-chip": {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      border: "1.5px solid var(--ink)",
      background: "var(--card)",
      padding: "8px 12px",
      fontSize: "12.5px",
      fontWeight: "600",
      color: "var(--ink)"
    },
    ".retro-layout .mobile-platform-chip svg": {
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .mobile-platform-chip svg": {
      color: "var(--phosphor)"
    },
    ".retro-layout .mobile-platform-chip.is-detected": {
      borderColor: "var(--accent-dim)",
      boxShadow: "3px 3px 0 var(--accent-dim)"
    },
    ".retro-layout .mobile-platform-chip em": {
      fontStyle: "normal",
      fontSize: "10px",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .mobile-platform-chip.is-detected": {
      borderColor: "var(--accent)",
      boxShadow: "3px 3px 0 color-mix(in srgb, var(--accent) 45%, transparent)"
    },
    ".dark .retro-layout .mobile-platform-chip em": {
      color: "var(--phosphor)"
    },
    ".retro-layout .legal-page": {
      position: "relative",
      zIndex: "2",
      padding: "54px 0 84px"
    },
    ".retro-layout .legal-doc": {
      maxWidth: "860px",
      padding: "36px"
    },
    ".retro-layout .legal-doc h1": {
      fontFamily: "var(--mono-display)",
      fontSize: "clamp(30px, 4.2vw, 48px)",
      lineHeight: "1.08",
      letterSpacing: "-0.02em",
      margin: "12px 0 8px",
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .legal-doc h1": {
      color: "var(--phosphor)"
    },
    ".retro-layout .legal-updated": {
      color: "var(--ink-soft)",
      fontSize: "12px",
      marginBottom: "34px"
    },
    ".retro-layout .legal-doc section": {
      borderTop: "1px solid var(--line-soft)",
      paddingTop: "22px",
      marginTop: "22px"
    },
    ".retro-layout .legal-doc h2": {
      fontFamily: "var(--mono-display)",
      fontSize: "18px",
      marginBottom: "8px"
    },
    ".retro-layout .legal-doc p": {
      color: "var(--ink-soft)",
      maxWidth: "72ch",
      fontSize: "14px"
    },
    ".retro-layout .foot-legal-links": {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      flexWrap: "wrap"
    },
    ".retro-layout .foot-legal-links a": {
      color: "var(--ink-soft)",
      textDecoration: "none"
    },
    ".retro-layout .foot-legal-links a:hover": {
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .foot-legal-links a:hover": {
      color: "var(--phosphor)"
    },
    ".retro-layout .legal-doc ul": {
      color: "var(--ink-soft)",
      maxWidth: "72ch",
      fontSize: "14px",
      paddingLeft: "22px",
      margin: "8px 0",
      listStyle: "square"
    },
    ".retro-layout .legal-doc ul li": {
      margin: "4px 0"
    },
    ".retro-layout .legal-download": {
      display: "inline-flex",
      alignItems: "center",
      gap: "7px",
      marginBottom: "26px",
      padding: "8px 14px",
      fontFamily: "var(--mono-display)",
      fontSize: "12px",
      letterSpacing: "0.02em",
      color: "var(--ink)",
      background: "transparent",
      border: "1px solid var(--line-soft)",
      borderRadius: "6px",
      cursor: "pointer"
    },
    ".retro-layout .legal-download:hover": {
      borderColor: "var(--accent-dim)",
      color: "var(--accent-dim)"
    },
    ".dark .retro-layout .legal-download:hover": {
      borderColor: "var(--phosphor)",
      color: "var(--phosphor)"
    },
    "@media (min-width: 48rem)": {
      ".chat-action-button,\n  .chat-actions > button": {
        scrollSnapAlign: "end"
      },
      ".chat-only-desktop": {
        display: "inline-flex"
      },
      ".chat-only-compact": {
        display: "none"
      }
    },
    "@media (max-width: 768px)": {
      ".chat-page-shell .chat-action-button,\n  .chat-page-shell .chat-actions > button": {
        width: "2.25rem",
        height: "2.25rem",
        minWidth: "2.25rem",
        minHeight: "2.25rem",
        padding: "0",
        fontSize: "0.875rem"
      },
      ".chat-page-shell .chat-action-button svg,\n  .chat-page-shell .chat-actions > button svg": {
        width: "1rem",
        height: "1rem"
      },
      "body:not(.chat-shell-active) button,\n  body:not(.chat-shell-active) [role=\"button\"],\n  body:not(.chat-shell-active) .btn": {
        minHeight: "44px",
        minWidth: "44px",
        padding: "0.75rem 1rem",
        fontSize: "1rem"
      },
      "body:not(.chat-shell-active) input,\n  body:not(.chat-shell-active) textarea,\n  body:not(.chat-shell-active) select": {
        minHeight: "44px",
        fontSize: "16px",
        padding: "0.75rem"
      },
      "body:not(.chat-shell-active) .gap-1": {
        gap: "0.5rem !important"
      },
      "body:not(.chat-shell-active) .gap-2": {
        gap: "0.75rem !important"
      },
      "body:not(.chat-shell-active) .gap-3": {
        gap: "1rem !important"
      },
      "header .text-lg": {
        fontSize: "1.125rem"
      },
      "dialog button,\n  [role=\"dialog\"] button": {
        width: "100%",
        marginBottom: "0.5rem"
      },
      "[role=\"dialog\"] .dialog-icon-button": {
        width: "2rem !important",
        marginBottom: "0 !important"
      },
      "[role=\"dialog\"] .dialog-compact-button": {
        width: "auto !important",
        marginBottom: "0 !important"
      },
      "body:not(.chat-shell-active) button svg,\n  body:not(.chat-shell-active) [role=\"button\"] svg": {
        width: "1.5rem",
        height: "1.5rem"
      },
      ".settings-panel,\n  [class*=\"settings-panel\"]": {
        padding: "1.5rem"
      },
      "body:not(.chat-shell-active) select,\n  body:not(.chat-shell-active) [role=\"combobox\"]": {
        minHeight: "48px",
        padding: "0.75rem 2.5rem 0.75rem 1rem"
      },
      ".close-btn,\n  [aria-label=\"close\"],\n  button[title=\"Close\"]": {
        minWidth: "48px",
        minHeight: "48px",
        padding: "0.75rem"
      }
    },
    "@media (max-width: 640px)": {
      ".chat-page-shell .chat-avatar": {
        display: "none"
      },
      ".chat-page-shell .you-bubble": {
        padding: "8px 10px"
      },
      ".chat-page-shell .msg-meta": {
        marginBottom: "4px"
      },
      ".chat-page-shell .chat-action-button,\n  .chat-page-shell .chat-actions > button": {
        width: "2rem",
        height: "2rem",
        minWidth: "2rem",
        minHeight: "2rem",
        padding: "0"
      },
      "html,\n  body,\n  #root": {
        maxWidth: "100%",
        overflowX: "clip"
      },
      ".retro-layout .hero": {
        padding: "40px 0 56px"
      },
      ".retro-layout.retro-page": {
        width: "100%",
        maxWidth: "100vw",
        overflowX: "clip"
      },
      ".retro-layout.retro-page main,\n  .retro-layout.retro-page section,\n  .retro-layout.retro-page footer": {
        width: "100%",
        maxWidth: "100vw",
        overflowX: "clip"
      },
      "#main-nav > div": {
        width: "100%",
        maxWidth: "100%",
        minWidth: "0",
        boxSizing: "border-box"
      },
      "#main-nav .nav-logo": {
        minWidth: "0",
        overflow: "hidden"
      },
      "#main-nav .nav-mobile-actions": {
        flexShrink: "0"
      },
      ".retro-layout .wrap": {
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "0 20px"
      },
      ".retro-layout .hero-wrap": {
        width: "100%",
        maxWidth: "100% !important",
        overflowX: "clip"
      },
      ".retro-layout .wrap > *": {
        minWidth: "0",
        maxWidth: "100%"
      },
      ".retro-layout .hero-grid": {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) !important",
        gap: "28px",
        width: "100%",
        maxWidth: "100%",
        minWidth: "0",
        justifyItems: "stretch"
      },
      ".retro-layout .hero-content": {
        width: "100% !important",
        maxWidth: "100% !important",
        minWidth: "0",
        overflowX: "clip"
      },
      ".retro-layout .hero-coords": {
        width: "100%",
        maxWidth: "100%",
        marginBottom: "28px",
        lineHeight: "1.65",
        whiteSpace: "normal",
        overflowWrap: "anywhere"
      },
      ".retro-layout .hero-brand": {
        fontSize: "clamp(36px, 13.5vw, 52px)",
        lineHeight: "1",
        letterSpacing: "-0.02em",
        overflowWrap: "anywhere"
      },
      ".retro-layout .hero-brand-suffix": {
        fontSize: "0.34em"
      },
      ".retro-layout .hero-headline": {
        maxWidth: "100%",
        fontSize: "clamp(18px, 6.2vw, 22px)",
        lineHeight: "1.28",
        letterSpacing: "0"
      },
      ".retro-layout .hero-sub": {
        fontSize: "14px",
        lineHeight: "1.35",
        overflowWrap: "anywhere"
      },
      ".retro-layout .hero-copy": {
        width: "100%",
        maxWidth: "100% !important",
        fontSize: "15px",
        lineHeight: "1.75",
        overflowWrap: "anywhere"
      },
      ".retro-layout .hero-ctas": {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "12px",
        width: "100%",
        maxWidth: "100%",
        marginBottom: "24px"
      },
      ".retro-layout .hero-ctas .keating-btn-retro": {
        width: "100%",
        minWidth: "0",
        maxWidth: "100%",
        whiteSpace: "normal",
        textAlign: "center",
        justifyContent: "center",
        overflowWrap: "anywhere"
      },
      ".retro-layout .caps-grid": {
        gridTemplateColumns: "1fr !important"
      },
      ".retro-layout .term-3d": {
        height: "330px"
      },
      ".retro-layout .man-grid": {
        gridTemplateColumns: "1fr !important"
      },
      ".retro-layout .use-grid": {
        gridTemplateColumns: "1fr !important"
      },
      ".retro-layout .man-stamp": {
        right: "4px",
        top: "-40px",
        fontSize: "11px"
      },
      ".retro-layout .foot-grid": {
        gridTemplateColumns: "1fr !important"
      },
      ".retro-layout .term-foot div:nth-child(2)": {
        display: "none"
      },
      ".retro-layout .download-hero": {
        paddingTop: "48px"
      },
      ".retro-layout .download-feature-list": {
        gridTemplateColumns: "1fr"
      },
      ".retro-layout .download-screen": {
        minHeight: "230px",
        padding: "20px"
      },
      ".retro-layout .legal-doc": {
        padding: "24px"
      }
    },
    "@media (max-width: 480px)": {
      "body:not(.chat-shell-active) button,\n  body:not(.chat-shell-active) [role=\"button\"]": {
        minHeight: "48px",
        padding: "0.875rem 1.25rem"
      },
      body: {
        fontSize: "16px"
      },
      ".button-group,\n  [class*=\"button-group\"]": {
        flexDirection: "column",
        width: "100%"
      },
      ".button-group button,\n  [class*=\"button-group\"] button": {
        width: "100%"
      }
    },
    "@media (max-width: 360px)": {
      ".retro-layout .hero-wrap": {
        padding: "0 18px"
      },
      ".retro-layout .nav-logo": {
        gap: "0.375rem !important",
        padding: "0.125rem 0.25rem !important"
      },
      ".retro-layout .nav-logo img": {
        height: "1.55rem !important"
      },
      ".retro-layout .nav-version": {
        fontSize: "0.66rem",
        letterSpacing: "0.04em"
      },
      ".retro-layout .nav-mobile-actions": {
        gap: "0.375rem"
      },
      ".retro-layout .nav-mobile-toggle": {
        minHeight: "40px !important",
        padding: "0.25rem 0.5rem !important",
        fontSize: "0.9rem !important"
      },
      ".retro-layout .hero-copy": {
        maxWidth: "100% !important"
      },
      ".retro-layout .hero-ctas": {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "10px",
        width: "100%",
        maxWidth: "100%",
        alignItems: "stretch"
      },
      ".retro-layout .hero-ctas .keating-btn-retro": {
        width: "100%",
        minWidth: "0",
        minHeight: "44px",
        padding: "0.5rem 0.375rem !important",
        justifyContent: "center",
        textAlign: "center",
        fontSize: "10px",
        lineHeight: "1.15",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
        overflowWrap: "normal"
      }
    },
    "@media (prefers-reduced-motion: reduce)": {
		".chat-brand,\n  .chat-brand img,\n  .chat-page-shell .sb-dot,\n  .keating-thinking-mascot img,\n  .keating-thinking-dot,\n  .live-mascot-frame,\n  .keating-static-mascot": {
        transition: "none",
        animation: "none"
      },
      ".flashcard-3d": {
        transition: "none"
      },
      ".flashcard-exit-left,\n  .flashcard-exit-right,\n  .flashcard-exit-up,\n  .flashcard-exit-down,\n  .flashcard-exit-fade,\n  .flashcard-enter,\n  .flashcard-streak-pop,\n  .flashcard-milestone-pulse": {
        animationDuration: "1ms",
        animationIterationCount: "1"
      },
      ".retro-layout .hero h1 .cursor,\n  .retro-layout .t-caret,\n  .retro-layout .nav-status .dot": {
        animation: "none !important"
      },
      ".retro-layout .download-screen-caret": {
        animation: "none"
      }
    },
    "@media (min-width: 1180px)": {
      ".retro-layout .hero-grid": {
        gridTemplateColumns: "minmax(0, 41fr) minmax(620px, 59fr)",
        gap: "56px"
      },
      ".retro-layout .term-3d": {
        minHeight: "500px"
      }
    },
    "@media (min-width: 981px) and (max-width: 1179px)": {
      ".retro-layout .hero": {
        padding: "52px 0 72px"
      },
      ".retro-layout .hero-coords": {
        marginBottom: "26px"
      },
      ".retro-layout .hero-grid": {
        gridTemplateColumns: "minmax(440px, 0.92fr) minmax(360px, 1fr)",
        gap: "32px",
        alignItems: "center"
      },
      ".retro-layout .hero-copy": {
        maxWidth: "42ch",
        marginBottom: "28px"
      },
      ".retro-layout .hero-ctas": {
        gap: "12px",
        marginBottom: "24px"
      },
      ".retro-layout .hero-stage": {
        minHeight: "430px"
      },
      ".retro-layout .term-3d": {
        minHeight: "380px",
        maxHeight: "460px"
      }
    },
    "@media (min-width: 1152px)": {
      ".nav-desktop": {
        display: "flex !important",
        alignItems: "center",
        gap: "1rem"
      },
      ".nav-mobile-actions": {
        display: "none !important"
      },
      ".nav-desktop-link": {
        fontSize: "0.875rem"
      },
      ".nav-mobile-toggle": {
        display: "none !important"
      }
    },
    "@media (max-width: 980px)": {
      ".retro-layout .hero": {
        padding: "48px 0 70px"
      },
      ".retro-layout .hero-grid": {
        gridTemplateColumns: "1fr",
        gap: "28px",
        justifyItems: "center"
      },
      ".retro-layout .hero-wrap": {
        maxWidth: "720px"
      },
      ".retro-layout .hero-content": {
        width: "min(100%, 42rem)",
        margin: "0 auto"
      },
      ".retro-layout .hero-coords": {
        width: "min(100%, 42rem)",
        marginLeft: "auto",
        marginRight: "auto"
      },
      ".retro-layout .hero-grid,\n  .retro-layout .caps-grid,\n  .retro-layout .man-grid,\n  .retro-layout .use-grid,\n  .retro-layout .foot-grid,\n  .retro-layout .download-hero-grid,\n  .retro-layout .mobile-soon-grid,\n  .retro-layout .download-source-box,\n  .retro-layout .desktop-download-grid": {
        width: "100%",
        maxWidth: "100%",
        minWidth: "0"
      },
      ".retro-layout .hero-copy": {
        maxWidth: "48rem"
      },
      ".retro-layout .hero-stage": {
        paddingLeft: "0",
        paddingTop: "86px",
        minHeight: "0",
        width: "100%",
        maxWidth: "620px",
        overflowX: "clip"
      },
      ".retro-layout .term-3d": {
        height: "360px",
        minHeight: "320px",
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden"
      },
      ".retro-layout .caps-grid": {
        gridTemplateColumns: "1fr 1fr"
      },
      ".retro-layout .use-grid": {
        gridTemplateColumns: "1fr 1fr"
      },
      ".retro-layout .foot-grid": {
        gridTemplateColumns: "1fr 1fr"
      },
      ".retro-layout .download-hero-grid,\n  .retro-layout .mobile-soon-grid,\n  .retro-layout .download-source-box": {
        gridTemplateColumns: "1fr"
      },
      ".retro-layout .desktop-download-grid": {
        gridTemplateColumns: "1fr"
      },
      ".retro-layout .download-source-box .keating-btn-retro": {
        justifySelf: "start"
      }
    },
    "@media print": {
      ".retro-layout.legal-layout nav,\n  .retro-layout.legal-layout footer,\n  .retro-layout.legal-layout .print-hidden": {
        display: "none !important"
      },
      ".retro-layout.legal-layout .legal-page": {
        padding: "0"
      },
      ".retro-layout.legal-layout .legal-doc,\n  .retro-layout.legal-layout .legal-doc.keating-paper-card": {
        maxWidth: "none",
        padding: "0",
        border: "none",
        boxShadow: "none",
        background: "#fff"
      },
      ".retro-layout.legal-layout .legal-doc.keating-paper-card::before": {
        display: "none"
      },
      ".retro-layout.legal-layout .legal-doc h1,\n  .retro-layout.legal-layout .legal-doc h2,\n  .retro-layout.legal-layout .legal-doc p,\n  .retro-layout.legal-layout .legal-doc ul,\n  .retro-layout.legal-layout .legal-updated": {
        color: "#000"
      },
      ".retro-layout.legal-layout .legal-doc section": {
        breakInside: "avoid-page",
        borderTopColor: "#ccc"
      },
      ".retro-layout.legal-layout .legal-doc a": {
        color: "#000",
        textDecoration: "underline"
      }
    }
  },
  hooks: {
    "cssgen:done": ({ artifact, content }) => {
      if (artifact !== "styles.css") return;
      return appendUnlayeredAppStyles(content);
    }
  }
});
