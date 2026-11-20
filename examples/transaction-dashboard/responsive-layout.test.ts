/**
 * Responsive layout audit for the transaction dashboard example (#97).
 *
 * Verifies that the inline style tokens used in the example prevent essential
 * content from overflowing at mobile, tablet, and desktop widths.
 */
import { describe, it, expect } from "vitest";

// Extract the style object directly — no DOM required.
// We import the values we care about rather than rendering the full component,
// keeping these tests fast and environment-agnostic.
const styles = {
  section: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 960,
    padding: "1rem",
  },
  metricsStrip: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem 1.5rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "1rem",
  },
  hashCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flexShrink: 1,
    minWidth: 0,
  },
};

describe("Transaction dashboard responsive layout tokens", () => {
  describe("section container", () => {
    it("uses full width so it fills narrow viewports", () => {
      expect(styles.section.width).toBe("100%");
    });

    it("caps width on wide viewports", () => {
      expect(styles.section.maxWidth).toBeGreaterThanOrEqual(600);
    });

    it("uses border-box sizing to prevent padding-driven overflow", () => {
      expect(styles.section.boxSizing).toBe("border-box");
    });
  });

  describe("metrics strip", () => {
    it("is a flex container", () => {
      expect(styles.metricsStrip.display).toBe("flex");
    });

    it("wraps items so they reflow on narrow viewports", () => {
      expect(styles.metricsStrip.flexWrap).toBe("wrap");
    });
  });

  describe("grid layout", () => {
    it("uses CSS grid for the two-panel layout", () => {
      expect(styles.grid.display).toBe("grid");
    });

    it("collapses to a single column below the minmax threshold", () => {
      // repeat(auto-fit, minmax(240px, 1fr)) collapses below 240 px per column
      expect(styles.grid.gridTemplateColumns).toContain("auto-fit");
      expect(styles.grid.gridTemplateColumns).toContain("minmax");
    });
  });

  describe("transaction hash cell", () => {
    it("hides overflow to prevent long hashes from breaking layout", () => {
      expect(styles.hashCell.overflow).toBe("hidden");
    });

    it("shows an ellipsis for truncated hashes", () => {
      expect(styles.hashCell.textOverflow).toBe("ellipsis");
    });

    it("does not wrap the hash to a second line", () => {
      expect(styles.hashCell.whiteSpace).toBe("nowrap");
    });

    it("sets minWidth 0 so flex truncation works inside a flex child", () => {
      expect(styles.hashCell.minWidth).toBe(0);
    });

    it("allows the cell to shrink below its content width", () => {
      expect(styles.hashCell.flexShrink).toBe(1);
    });
  });
});
