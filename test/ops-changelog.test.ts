import { describe, expect, test } from "bun:test";
import { withChangelogSection } from "../scripts/ops/release.js";

const changelog = "# Changelog\n\nIntro.\n\n## 1.2.0\n\n- Older change.\n\n## 1.1.0\n\n- Oldest change.\n";
const tricky = "- Price is $5 ($$ escaped, $& matched, $' after, $` before).";

describe("withChangelogSection", () => {
  test("inserts a new release above the newest one", () => {
    const updated = withChangelogSection(changelog, "1.3.0", "- New change.");
    expect(updated).toBe("# Changelog\n\nIntro.\n\n## 1.3.0\n\n- New change.\n\n## 1.2.0\n\n- Older change.\n\n## 1.1.0\n\n- Oldest change.\n");
  });

  test("replaces an existing section for the same version and keeps the others", () => {
    const updated = withChangelogSection(changelog, "1.2.0", "- Rewritten.");
    expect(updated).toContain("## 1.2.0\n\n- Rewritten.\n\n## 1.1.0");
    expect(updated).not.toContain("Older change");
    expect(updated).toContain("- Oldest change.");
  });

  test("keeps dollar sequences in notes literal when inserting and replacing", () => {
    const inserted = withChangelogSection(changelog, "1.3.0", tricky);
    expect(inserted).toContain(`## 1.3.0\n\n${tricky}\n\n## 1.2.0`);
    expect(inserted.match(/## 1\.2\.0/g)).toHaveLength(1);
    const replaced = withChangelogSection(changelog, "1.2.0", tricky);
    expect(replaced).toContain(`## 1.2.0\n\n${tricky}\n\n## 1.1.0`);
    expect(replaced.match(/## 1\.1\.0/g)).toHaveLength(1);
  });

  test("refuses a changelog without any release heading", () => {
    expect(() => withChangelogSection("# Changelog\n", "1.0.0", "- First.")).toThrow("level-two version heading");
  });
});
