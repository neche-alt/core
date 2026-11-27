import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Framework Examples Setup and Maintenance (#66)", () => {
  const examplesDir = path.resolve(__dirname, "../../examples");
  const exampleReadmePath = path.join(examplesDir, "README.md");
  const readmeContent = fs.readFileSync(exampleReadmePath, "utf8");

  const expectedExamples = [
    "next-serverless",
    "react-wallet-connect",
    "router-swap",
    "transaction-dashboard",
    "vue-soroban",
  ];

  it("shared example index documents all framework examples and maintenance steps", () => {
    expect(readmeContent).toContain("Example Index");
    expect(readmeContent).toContain("Prerequisites & Installation");
    expect(readmeContent).toContain("Running & Typechecking Examples");
    expect(readmeContent).toContain("Contributor Maintenance Checklist for SDK Releases");

    for (const ex of expectedExamples) {
      expect(readmeContent).toContain(ex);
      expect(
        fs.existsSync(path.join(examplesDir, ex)),
        `Example directory missing: ${ex}`,
      ).toBe(true);
    }
  });

  it("each example directory contains its own documentation README", () => {
    for (const ex of expectedExamples) {
      const exReadme = path.join(examplesDir, ex, "README.md");
      expect(
        fs.existsSync(exReadme),
        `Example "${ex}" is missing a README.md`,
      ).toBe(true);
    }
  });

  it("all source files in examples use only public package imports", () => {
    function scanFiles(dir: string): string[] {
      let results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
          results = results.concat(scanFiles(full));
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx") ||
            entry.name.endsWith(".vue"))
        ) {
          results.push(full);
        }
      }
      return results;
    }

    const sourceFiles = scanFiles(examplesDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    const disallowedInternalPattern = /from\s+["'](\.\.\/)+src\/(shared|wallet|soroban|network|account|transaction)\//;

    for (const file of sourceFiles) {
      const code = fs.readFileSync(file, "utf8");
      expect(
        disallowedInternalPattern.test(code),
        `File ${path.relative(examplesDir, file)} imports private internal SDK source directly instead of public package exports`,
      ).toBe(false);
    }
  });

  it("boundary test: disallowed internal import detector catches internal leaks", () => {
    const dummyBadCode = 'import { internalCache } from "../../../src/shared/cache";';
    const disallowedInternalPattern = /from\s+["'](\.\.\/)+src\/(shared|wallet|soroban|network|account|transaction)\//;
    expect(disallowedInternalPattern.test(dummyBadCode)).toBe(true);
  });
});
