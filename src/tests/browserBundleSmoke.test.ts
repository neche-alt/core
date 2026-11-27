/**
 * Browser bundle smoke tests (#116).
 *
 * Verifies that:
 *  1. All documented public SDK exports resolve and behave correctly in a
 *     non-Node environment (the fixture exercises them).
 *  2. The server-only import checker correctly identifies Node.js-only requires.
 */
import { describe, it, expect } from "vitest";
import { runSmoke } from "../../../tests/browser-smoke/fixture";
import { checkForServerOnlyImports } from "../../../tests/browser-smoke/check-server-only";

describe("browser bundle smoke (#116)", () => {
  describe("public SDK exports", () => {
    it("all documented public imports resolve and return expected shapes", () => {
      const result = runSmoke();
      expect(result.ok).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it("smoke fixture covers EndpointRegistry", () => {
      const result = runSmoke();
      expect(result.checks.some((c) => c.includes("EndpointRegistry"))).toBe(true);
    });

    it("smoke fixture covers EndpointPool", () => {
      const result = runSmoke();
      expect(result.checks.some((c) => c.includes("EndpointPool"))).toBe(true);
    });

    it("smoke fixture covers telemetry validation", () => {
      const result = runSmoke();
      expect(result.checks.some((c) => c.includes("validateTelemetryConfig"))).toBe(true);
    });

    it("smoke fixture covers SorokitResult helpers", () => {
      const result = runSmoke();
      expect(result.checks.some((c) => c.includes("ok()"))).toBe(true);
      expect(result.checks.some((c) => c.includes("err()"))).toBe(true);
    });
  });

  describe("server-only import detection", () => {
    it("detects require('fs') as a violation", () => {
      const violations = checkForServerOnlyImports(`var fs = require('fs');`);
      expect(violations).toContain("require('fs')");
    });

    it("detects require(\"path\") as a violation", () => {
      const violations = checkForServerOnlyImports(`const p = require("path");`);
      expect(violations).toContain("require('path')");
    });

    it("detects multiple violations", () => {
      const bundleText = `
        var fs = require('fs');
        var net = require('net');
      `;
      const violations = checkForServerOnlyImports(bundleText);
      expect(violations.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty array for a clean bundle", () => {
      const cleanBundle = `
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        function ok(data) { return { status: "ok", data }; }
        exports.ok = ok;
      `;
      const violations = checkForServerOnlyImports(cleanBundle);
      expect(violations).toHaveLength(0);
    });

    it("does not flag globalThis.Buffer as a violation", () => {
      const bundleText = `var b = globalThis.Buffer.from("hello");`;
      const violations = checkForServerOnlyImports(bundleText);
      expect(violations).toHaveLength(0);
    });

    it("flags require('buffer') (the module) as a violation", () => {
      const bundleText = `var Buffer = require('buffer').Buffer;`;
      const violations = checkForServerOnlyImports(bundleText);
      expect(violations.some((v) => v.includes("require('buffer')"))).toBe(true);
    });
  });
});
