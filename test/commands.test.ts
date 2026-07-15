import { describe, expect, test } from "bun:test";

import { cliCommandSpecs, cliCommandSections } from "../src/core/commands.js";

describe("CLI command catalog", () => {
  test("keeps the alternate OpenTUI host separate from the classic Pi shell", () => {
    const shell = cliCommandSpecs.find((spec) => spec.name === "shell");
    const tui = cliCommandSpecs.find((spec) => spec.name === "tui");

    expect(shell?.description).toContain("hyperteacher shell");
    expect(tui).toMatchObject({ args: "[prompt]", section: "Core" });
    expect(tui?.description).toContain("OpenTUI");
  });

  test("includes both hosts in generated CLI help", () => {
    const usages = cliCommandSections().flatMap((section) => section.commands.map((command) => command.usage));
    expect(usages).toContain("keating shell [prompt]");
    expect(usages).toContain("keating tui [prompt]");
    expect(usages).toContain("keating web [port] [runtime options]");
  });
});
