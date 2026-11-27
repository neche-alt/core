import { describe, it, expect } from "vitest";
import {
  decodeNestedContractFailure,
  formatNestedContractFailure,
  ROUTER_CONTRACT_ERRORS,
  DEFAULT_CONTRACT_ERROR_MAP,
} from "./contractErrors";

describe("decodeNestedContractFailure", () => {
  it("decodes a flat (non-nested) error at depth 0", () => {
    const error = new Error("ROUTER_SLIPPAGE_EXCEEDED");
    const tree = decodeNestedContractFailure(error, ROUTER_CONTRACT_ERRORS);

    expect(tree.root.depth).toBe(0);
    expect(tree.root.decoded.decoded).toBe(true);
    expect(tree.root.decoded.message).toContain("slippage");
    expect(tree.totalFailures).toBe(1);
    expect(tree.flat).toHaveLength(1);
  });

  it("decodes nested causes into child nodes", () => {
    const error = {
      message: "ROUTER_1",
      causes: [
        { message: "FACTORY_1", causes: [] },
        { message: "ROUTER_3", causes: [] },
      ],
    };
    const tree = decodeNestedContractFailure(error, DEFAULT_CONTRACT_ERROR_MAP);

    expect(tree.root.children).toHaveLength(2);
    expect(tree.root.children[0].depth).toBe(1);
    expect(tree.root.children[1].depth).toBe(1);
    expect(tree.totalFailures).toBe(3);
    expect(tree.flat).toHaveLength(3);
  });

  it("recursively decodes deeply nested failures", () => {
    const error = {
      message: "top level",
      causes: [
        {
          message: "ROUTER_2",
          causes: [
            { message: "FACTORY_4", causes: [] },
          ],
        },
      ],
    };
    const tree = decodeNestedContractFailure(error, DEFAULT_CONTRACT_ERROR_MAP);

    expect(tree.totalFailures).toBe(3);
    expect(tree.flat[0].depth).toBe(0);
    expect(tree.flat[1].depth).toBe(1);
    expect(tree.flat[2].depth).toBe(2);
  });

  it("preserves original raw value at every node", () => {
    const rootError = { message: "ROUTER_1", causes: [{ message: "FACTORY_1" }] };
    const tree = decodeNestedContractFailure(rootError, DEFAULT_CONTRACT_ERROR_MAP);

    expect(tree.root.decoded.raw).toBe(rootError);
    expect(tree.root.children[0].decoded.raw).toBe(rootError.causes[0]);
  });

  it("handles errors without causes array gracefully", () => {
    const error = { message: "unknown error" };
    const tree = decodeNestedContractFailure(error, DEFAULT_CONTRACT_ERROR_MAP);

    expect(tree.root.children).toHaveLength(0);
    expect(tree.totalFailures).toBe(1);
  });

  it("never throws on malformed input", () => {
    expect(() => decodeNestedContractFailure(null)).not.toThrow();
    expect(() => decodeNestedContractFailure(undefined)).not.toThrow();
    expect(() => decodeNestedContractFailure({ causes: "not-an-array" })).not.toThrow();
  });

  it("flat list is depth-first ordered", () => {
    const error = {
      message: "root",
      causes: [
        { message: "child-1", causes: [{ message: "grandchild" }] },
        { message: "child-2" },
      ],
    };
    const tree = decodeNestedContractFailure(error, DEFAULT_CONTRACT_ERROR_MAP);
    const depths = tree.flat.map((n) => n.depth);
    expect(depths).toEqual([0, 1, 2, 1]);
  });
});

describe("formatNestedContractFailure", () => {
  it("formats a single-node tree as one line", () => {
    const tree = decodeNestedContractFailure({ message: "ROUTER_3" }, ROUTER_CONTRACT_ERRORS);
    const formatted = formatNestedContractFailure(tree);
    expect(formatted).toContain("[0]");
    expect(formatted).toContain("slippage");
    expect(formatted.split("\n")).toHaveLength(1);
  });

  it("indents child nodes by depth", () => {
    const error = {
      message: "ROUTER_1",
      causes: [{ message: "FACTORY_1" }],
    };
    const tree = decodeNestedContractFailure(error, DEFAULT_CONTRACT_ERROR_MAP);
    const formatted = formatNestedContractFailure(tree);
    const lines = formatted.split("\n");
    expect(lines[0]).toMatch(/^\[0\]/);
    expect(lines[1]).toMatch(/^  \[1\]/);
  });

  it("includes error code in output when decoded", () => {
    const tree = decodeNestedContractFailure("ROUTER_SLIPPAGE_EXCEEDED", ROUTER_CONTRACT_ERRORS);
    const formatted = formatNestedContractFailure(tree);
    expect(formatted).toContain("ROUTER_SLIPPAGE_EXCEEDED");
  });
});
