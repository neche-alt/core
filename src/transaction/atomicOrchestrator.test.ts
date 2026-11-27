import { describe, expect, it, vi } from "vitest";
import { err, SorokitErrorCode } from "../shared/response";
import { orchestrate, type AtomicStepDefinition } from "./atomicOrchestrator";
import { createAuditTrail } from "../compliance/auditTrail";

describe("atomic transaction orchestration", () => {
  it("executes steps in order and returns their results", async () => {
    const order: string[] = [];
    const result = await orchestrate()
      .step(async () => {
        order.push("swap");
        return "swapped";
      })
      .step(async ({ results }) => {
        order.push("deposit");
        expect(results).toEqual(["swapped"]);
        return "deposited";
      })
      .execute();

    expect(order).toEqual(["swap", "deposit"]);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        completedSteps: 2,
        results: ["swapped", "deposited"],
        attemptsByStep: [1, 1],
      },
    });
  });

  it("runs compensation after a partial failure", async () => {
    const rollback = vi.fn();
    const result = await orchestrate()
      .step(() => "swapped")
      .step(() => {
        throw new Error("deposit failed");
      })
      .onFailure(rollback)
      .execute();

    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        completedSteps: 1,
        failedStepIndex: 1,
        results: ["swapped"],
        failure: expect.any(Error),
      }),
    );
    expect(result.status).toBe("error");
  });

  it("retries the failed step without repeating completed steps", async () => {
    const firstStep = vi.fn(() => "ready");
    const secondStep = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue("done");

    const result = await orchestrate({ maxRetries: 1 })
      .step(firstStep)
      .step(secondStep)
      .execute();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.attemptsByStep).toEqual([1, 2]);
    }
    expect(firstStep).toHaveBeenCalledTimes(1);
    expect(secondStep).toHaveBeenCalledTimes(2);
  });

  it("treats an error SorokitResult as a failed step", async () => {
    const rollback = vi.fn();
    const result = await orchestrate()
      .step(() => err(SorokitErrorCode.TX_SUBMIT_FAILED, "step failed"))
      .onFailure(rollback)
      .execute();

    expect(result.status).toBe("error");
    expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ failedStepIndex: 0 }));
  });

  // ── #150: Saga compensation ───────────────────────────────────────────────

  describe("saga compensation", () => {
    it("calls per-step compensate callbacks in reverse order on failure", async () => {
      const order: string[] = [];

      const result = await orchestrate()
        .step({
          execute: () => "swapped",
          compensate: () => { order.push("undo-swap"); },
        })
        .step({
          execute: () => "settled",
          compensate: () => { order.push("undo-settle"); },
        })
        .step({
          execute: () => { throw new Error("notify failed"); },
        })
        .execute();

      expect(result.status).toBe("error");
      // undo-settle runs before undo-swap (reverse order)
      expect(order).toEqual(["undo-settle", "undo-swap"]);
    });

    it("skips steps without a compensate callback without error", async () => {
      const compensate = vi.fn();

      await orchestrate()
        .step({
          execute: () => "step-a",
          // no compensate
        })
        .step({
          execute: () => "step-b",
          compensate,
        })
        .step({
          execute: () => { throw new Error("step-c failed"); },
        })
        .execute();

      expect(compensate).toHaveBeenCalledTimes(1);
    });

    it("continues running compensations even if one throws", async () => {
      const secondCompensate = vi.fn();

      const result = await orchestrate()
        .step({
          execute: () => "first",
          compensate: secondCompensate,
        })
        .step({
          execute: () => "second",
          compensate: () => { throw new Error("compensation error"); },
        })
        .step({
          execute: () => { throw new Error("third failed"); },
        })
        .execute();

      // second step's compensation threw, but first step's should still run
      expect(secondCompensate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("error");
    });

    it("backward-compatible: bare function steps still work", async () => {
      const result = await orchestrate()
        .step(() => "plain")
        .step(() => "function")
        .execute();

      expect(result.status).toBe("ok");
      expect(result.data?.completedSteps).toBe(2);
    });

    it("successful execution includes a sagaId string", async () => {
      const result = await orchestrate()
        .step(() => "ok")
        .execute();

      expect(result.status).toBe("ok");
      expect(typeof result.data?.sagaId).toBe("string");
      expect(result.data?.sagaId).toMatch(/^saga_/);
    });

    it("failed execution exposes sagaId and compensationsRun in error detail", async () => {
      const result = await orchestrate()
        .step({ execute: () => "done", compensate: () => {} })
        .step({ execute: () => { throw new Error("fail"); } })
        .execute();

      expect(result.status).toBe("error");
      const detail = result.error?.cause as Record<string, unknown>;
      expect(typeof detail?.sagaId).toBe("string");
      expect(detail?.compensationsRun).toBe(1);
    });
  });
});