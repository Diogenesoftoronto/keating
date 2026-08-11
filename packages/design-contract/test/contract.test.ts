import { describe, expect, test } from "bun:test";

import {
  PALETTE_PROVENANCE,
  REQUIRED_CONTRAST,
  codepointCompare,
  contrastRatio,
  cssVariables,
  exportDesignContract,
  keatingDesignContract,
  stableCanonicalJson,
  terminalDesignProfile,
  terminalStateText,
  validateDesignContract,
} from "../src/index.js";

describe("Keating design contract", () => {
  test("contains every required semantic role and valid accessibility baseline", () => {
    const result = validateDesignContract();
    expect(result).toEqual({ ok: true, errors: [] });
  });

  test("reports malformed role sets without throwing", () => {
    const malformed = structuredClone(keatingDesignContract) as any;
    delete malformed.themes.light.colors.text;
    expect(validateDesignContract(malformed)).toMatchObject({ ok: false });
    expect(validateDesignContract(malformed).errors).toContain("light.text is required.");

    for (const invalid of [null, [], {}, { themes: null }, { ...keatingDesignContract, density: undefined, native: undefined }]) {
      expect(() => validateDesignContract(invalid)).not.toThrow();
      expect(validateDesignContract(invalid).ok).toBe(false);
    }
  });

  test("structurally validates every typography, spacing, radii, and native field", () => {
    const invalidations: readonly [string, (contract: any) => void][] = [
      ["typography.ui", (contract) => { contract.typography.ui = []; }],
      ["typography.display", (contract) => { contract.typography.display = ["", " "]; }],
      ["typography.mono", (contract) => { contract.typography.mono = null; }],
      ["typography.bodySizeRem", (contract) => { contract.typography.bodySizeRem = 0; }],
      ["typography.labelSizeRem", (contract) => { contract.typography.labelSizeRem = NaN; }],
      ["typography.bodyLineHeight", (contract) => { contract.typography.bodyLineHeight = -1; }],
      ["typography.labelLineHeight", (contract) => { contract.typography.labelLineHeight = "1.2"; }],
      ["typography.headingScale.sm", (contract) => { contract.typography.headingScale.sm = 0; }],
      ["typography.headingScale.md", (contract) => { contract.typography.headingScale.md = null; }],
      ["typography.headingScale.lg", (contract) => { contract.typography.headingScale.lg = Infinity; }],
      ["spacing.xxs", (contract) => { contract.spacing.xxs = ""; }],
      ["spacing.xs", (contract) => { contract.spacing.xs = null; }],
      ["spacing.sm", (contract) => { contract.spacing.sm = " "; }],
      ["spacing.md", (contract) => { contract.spacing.md = 12; }],
      ["spacing.lg", (contract) => { contract.spacing.lg = undefined; }],
      ["spacing.xl", (contract) => { contract.spacing.xl = []; }],
      ["radii.control", (contract) => { contract.radii.control = ""; }],
      ["radii.panel", (contract) => { contract.radii.panel = null; }],
      ["radii.pill", (contract) => { contract.radii.pill = 999; }],
      ["native.baseUnitDp", (contract) => { contract.native.baseUnitDp = 8; }],
      ["native.spacingDp.xxs", (contract) => { contract.native.spacingDp.xxs = 0; }],
      ["native.spacingDp.xs", (contract) => { contract.native.spacingDp.xs = null; }],
      ["native.spacingDp.sm", (contract) => { contract.native.spacingDp.sm = NaN; }],
      ["native.spacingDp.md", (contract) => { contract.native.spacingDp.md = -1; }],
      ["native.spacingDp.lg", (contract) => { contract.native.spacingDp.lg = Infinity; }],
      ["native.spacingDp.xl", (contract) => { contract.native.spacingDp.xl = "24"; }],
      ["native.radiiDp.control", (contract) => { contract.native.radiiDp.control = 0; }],
      ["native.radiiDp.panel", (contract) => { contract.native.radiiDp.panel = null; }],
      ["native.radiiDp.pill", (contract) => { contract.native.radiiDp.pill = NaN; }],
      ["native.compactControlMinDp", (contract) => { contract.native.compactControlMinDp = 0; }],
      ["native.regularControlMinDp", (contract) => { contract.native.regularControlMinDp = 40; }],
      ["native.minimumTouchTargetDp", (contract) => { contract.native.minimumTouchTargetDp = 40; }],
      ["native.focusRingDp", (contract) => { contract.native.focusRingDp = 0; }],
    ];

    for (const [field, invalidate] of invalidations) {
      const malformed = structuredClone(keatingDesignContract) as any;
      invalidate(malformed);
      const result = validateDesignContract(malformed);
      expect(result.ok, field).toBe(false);
      expect(result.errors.join("\n"), field).toContain(field);
    }
  });

  test("keeps normal and large text contrast above their respective thresholds", () => {
    for (const theme of ["light", "dark"] as const) {
      const colors = keatingDesignContract.themes[theme].colors;
      for (const requirement of REQUIRED_CONTRAST) {
        expect(contrastRatio(colors[requirement.foreground], colors[requirement.background])).toBeGreaterThanOrEqual(requirement.threshold);
      }
    }
  });

  test("exports contract and completely projects web-consumable roles to CSS", () => {
    expect(exportDesignContract()).toBe(exportDesignContract());
    expect(cssVariables("light")).toBe(cssVariables("light"));
    for (const theme of ["light", "dark"] as const) {
      const css = cssVariables(theme);
      for (const [role, value] of Object.entries(keatingDesignContract.themes[theme].colors)) {
        const cssRole = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        expect(css).toContain(`--keating-${cssRole}: ${value};`);
      }
      expect(css).toContain(`--keating-font-ui: ${keatingDesignContract.typography.ui.join(", ")};`);
      expect(css).toContain(`--keating-font-display: ${keatingDesignContract.typography.display.join(", ")};`);
      expect(css).toContain(`--keating-font-mono: ${keatingDesignContract.typography.mono.join(", ")};`);
      expect(css).toContain(`--keating-body-size: ${keatingDesignContract.typography.bodySizeRem}rem;`);
      expect(css).toContain(`--keating-label-size: ${keatingDesignContract.typography.labelSizeRem}rem;`);
      for (const [name, value] of Object.entries(keatingDesignContract.spacing)) expect(css).toContain(`--keating-space-${name}: ${value};`);
      for (const [name, value] of Object.entries(keatingDesignContract.radii)) expect(css).toContain(`--keating-radius-${name}: ${value};`);
      expect(css).toContain(`--keating-disabled-opacity: ${keatingDesignContract.states.disabledOpacity};`);
      expect(css).toContain(`--keating-error-text-prefix: ${keatingDesignContract.states.errorTextPrefix};`);
      expect(css).toContain(`--keating-motion-reduced: ${keatingDesignContract.motion.reducedMotion};`);
      expect(css).toContain(`--keating-terminal-row-height: ${keatingDesignContract.density.terminalRowHeight};`);
    }
  });

  test("documents and proves the live green-paper palette provenance", async () => {
    const panda = await Bun.file(new URL("../../../web/panda.config.ts", import.meta.url)).text();
    const artifactTheme = await Bun.file(new URL("../../../src/core/artifact-theme.ts", import.meta.url)).text();
    const ansiTheme = await Bun.file(new URL("../../../src/core/theme.ts", import.meta.url)).text();
    expect(panda).toContain('paper: { value: { base: "#f1ece0", _dark: "#0c1510" } }');
    expect(panda).toContain('accentDim: { value: { base: "#14743c", _dark: "#4be388" } }');
    expect(panda).toContain('primaryForeground: { value: { base: "#ffffff", _dark: "#0c1510" } }');
    expect(panda).toContain('ui: \'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif\'');
    expect(panda).toContain('monoDisplay: \'"Space Mono", ui-monospace, "Cascadia Mono", Menlo, monospace\'');
    expect(panda).toContain('monoBody: \'"JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, monospace\'');
    expect(artifactTheme).toContain('paper: "#f1ece0"');
    expect(artifactTheme).toContain('phosphor: "#4be388"');
    expect(ansiTheme).toContain("// Primary green — matches web --primary #10b981");
    expect(PALETTE_PROVENANCE.light.surface).toBe("#f1ece0");
    expect(PALETTE_PROVENANCE.light.onAccent).toBe("#ffffff");
    expect(PALETTE_PROVENANCE.dark.accent).toBe("#4be388");
    expect(keatingDesignContract.typography.ui).toEqual(["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"]);
    expect(keatingDesignContract.typography.display).toEqual(["Space Mono", "ui-monospace", "Cascadia Mono", "Menlo", "monospace"]);
    expect(keatingDesignContract.typography.mono).toEqual(["JetBrains Mono", "ui-monospace", "Cascadia Mono", "Menlo", "monospace"]);
  });

  test("has a native projection with a guaranteed 44dp touch target", () => {
    expect(keatingDesignContract.native.baseUnitDp).toBe(4);
    expect(keatingDesignContract.native.minimumTouchTargetDp).toBe(44);
    expect(keatingDesignContract.native.regularControlMinDp).toBeGreaterThanOrEqual(44);
  });

  test("terminal profiles exhaust every mode, role, and state without relying on color", () => {
    const roles = ["text", "mutedText", "accent", "focus", "success", "warning", "danger", "info"] as const;
    const states = ["ready", "active", "success", "warning", "error", "disabled"] as const;
    const modes = ["truecolor", "ansi256", "ansi16", "none"] as const;
    const glyphModes = ["unicode", "ascii"] as const;

    for (const theme of ["light", "dark"] as const) {
      for (const colorMode of modes) {
        for (const glyphMode of glyphModes) {
          const profile = terminalDesignProfile(theme, colorMode, glyphMode);
          for (const role of roles) {
            const token = profile.colors[role];
            if (colorMode === "none") expect(token).toBeUndefined();
            else if (colorMode === "truecolor") expect(token?.truecolor).toBe(keatingDesignContract.themes[theme].colors[role]);
            else if (colorMode === "ansi256") expect(token?.ansi256).toBeTypeOf("number");
            else expect(token?.ansi16).toBeTypeOf("number");
          }
          for (const state of states) {
            const text = terminalStateText(state, profile);
            expect(text).toContain(profile.states[state].label);
            expect(profile.states[state].glyph.length).toBeGreaterThan(0);
            if (glyphMode === "ascii") expect(profile.states[state].glyph).toMatch(/^[\x20-\x7e]+$/);
            if (colorMode === "none") expect(profile.states[state].color).toBeUndefined();
          }
        }
      }
    }
  });

  test("uses codepoint ordering and a stable canonical golden form", () => {
    const reordered = { "ä": 2, z: 3, A: { "β": 2, a: 1 } };
    expect(codepointCompare("z", "ä")).toBeLessThan(0);
    expect(stableCanonicalJson(reordered)).toBe('{"A":{"a":1,"β":2},"z":3,"ä":2}');
    expect(exportDesignContract({ ...keatingDesignContract, themes: { dark: keatingDesignContract.themes.dark, light: keatingDesignContract.themes.light } })).toBe(exportDesignContract());
  });
});
