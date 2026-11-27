import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import * as sorokitCore from "../index";

describe("API Reference Task Navigation (#67)", () => {
  const docsDir = path.resolve(__dirname, "../../docs");
  const overviewPath = path.join(docsDir, "api-overview.md");
  const overviewContent = fs.readFileSync(overviewPath, "utf8");

  it("api-overview.md exists and contains task-based navigation sections", () => {
    expect(overviewContent).toContain("Task-Based Navigation");
    expect(overviewContent).toContain("Connect a Wallet");
    expect(overviewContent).toContain("Check Balances");
    expect(overviewContent).toContain("Build, Estimate Fees, and Submit Transactions");
    expect(overviewContent).toContain("Read, Simulate, and Invoke Soroban Contracts");
    expect(overviewContent).toContain("DEX Swaps");
    expect(overviewContent).toContain("Configure Networks");
  });

  it("all relative documentation links in api-overview.md resolve to existing files", () => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    const linksFound: string[] = [];

    while ((match = linkRegex.exec(overviewContent)) !== null) {
      const target = match[2];
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        linksFound.push(target);
      }
    }

    expect(linksFound.length).toBeGreaterThan(5);

    for (const relativeLink of linksFound) {
      // Strip any #hash fragment
      const cleanPath = relativeLink.split("#")[0];
      const resolved = path.resolve(docsDir, cleanPath);
      expect(
        fs.existsSync(resolved),
        `Link target does not exist: "${relativeLink}" (resolved to ${resolved})`,
      ).toBe(true);
    }
  });

  it("all TypeDoc {@link Symbol} references in api-overview.md exist in public exports", () => {
    const linkSymbolRegex = /\{@link\s+([A-Za-z0-9_]+)\}/g;
    let match;
    const symbolsFound: string[] = [];

    while ((match = linkSymbolRegex.exec(overviewContent)) !== null) {
      symbolsFound.push(match[1]);
    }

    expect(symbolsFound.length).toBeGreaterThan(5);

    for (const symbol of symbolsFound) {
      // SorokitClient and SorokitResult are types/interfaces; functions and classes are runtime values
      if (symbol === "SorokitClient" || symbol === "SorokitResult" || symbol === "WalletAdapter") {
        continue;
      }
      expect(
        (sorokitCore as Record<string, unknown>)[symbol],
        `Symbol referenced in {@link ${symbol}} is not exported from src/index.ts`,
      ).toBeDefined();
    }
  });

  it("boundary test: verifies link validator catches non-existent recipe references", () => {
    const fakeBrokenContent = "[Broken Recipe](recipes/99-non-existent-recipe.md)";
    const match = /\[([^\]]+)\]\(([^)]+)\)/.exec(fakeBrokenContent);
    expect(match).not.toBeNull();
    if (match) {
      const resolved = path.resolve(docsDir, match[2]);
      expect(fs.existsSync(resolved)).toBe(false);
    }
  });
});
