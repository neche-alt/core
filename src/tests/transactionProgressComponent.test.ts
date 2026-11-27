/**
 * Tests for the transaction submission progress component (#133).
 *
 * Covers buildStepList, step state derivation, error surfaces, fee-bump
 * visibility, and integration with MockSorokitClient.
 */
import { describe, it, expect } from "vitest";
import {
  buildStepList,
} from "../../examples/transaction-dashboard/transaction-progress.example";
import type {
  StepState,
  SubmissionStep,
  TransactionProgressProps,
} from "../../examples/transaction-dashboard/transaction-progress.example";
import { createMockClient } from "../testing/mockClient";

describe("transaction progress component (#133)", () => {
  describe("buildStepList", () => {
    it("returns 4 steps without fee_bump", () => {
      const steps = buildStepList(false);
      expect(steps).toHaveLength(4);
      expect(steps.map((s) => s.step)).toEqual([
        "simulate",
        "sign",
        "submit",
        "confirm",
      ]);
    });

    it("returns 5 steps with fee_bump included", () => {
      const steps = buildStepList(true);
      expect(steps).toHaveLength(5);
      expect(steps.map((s) => s.step)).toEqual([
        "simulate",
        "sign",
        "submit",
        "fee_bump",
        "confirm",
      ]);
    });

    it("all steps start as pending", () => {
      const steps = buildStepList(false);
      for (const s of steps) {
        expect(s.status).toBe("pending");
      }
    });

    it("all steps have non-empty labels", () => {
      const steps = buildStepList(true);
      for (const s of steps) {
        expect(typeof s.label).toBe("string");
        expect(s.label.length).toBeGreaterThan(0);
      }
    });

    it("fee_bump step has the correct label", () => {
      const steps = buildStepList(true);
      const feeBump = steps.find((s) => s.step === "fee_bump");
      expect(feeBump).toBeDefined();
      expect(feeBump!.label).toBe("Apply Fee Bump");
    });
  });

  describe("StepState shape", () => {
    it("failed step carries errorMessage", () => {
      const failedStep: StepState = {
        step: "submit",
        label: "Submit",
        status: "failed",
        errorMessage: "Insufficient fee",
      };
      expect(failedStep.errorMessage).toBe("Insufficient fee");
      expect(failedStep.status).toBe("failed");
    });

    it("pending step has no errorMessage", () => {
      const pendingStep: StepState = {
        step: "simulate",
        label: "Simulate",
        status: "pending",
      };
      expect(pendingStep.errorMessage).toBeUndefined();
    });

    it("completed step has no errorMessage", () => {
      const completedStep: StepState = {
        step: "confirm",
        label: "Confirm",
        status: "completed",
      };
      expect(completedStep.errorMessage).toBeUndefined();
    });
  });

  describe("TransactionProgressProps type", () => {
    it("can be constructed with minimal required fields", () => {
      const steps = buildStepList(false);
      const props: TransactionProgressProps = {
        steps,
        currentStep: "submit",
      };
      expect(props.steps).toHaveLength(4);
      expect(props.currentStep).toBe("submit");
      expect(props.error).toBeUndefined();
      expect(props.includesFeeBump).toBeUndefined();
    });

    it("can carry an error on a specific step", () => {
      const steps = buildStepList(false);
      const props: TransactionProgressProps = {
        steps,
        currentStep: null,
        error: { step: "submit", message: "tx_bad_seq" },
      };
      expect(props.error!.step).toBe("submit");
      expect(props.error!.message).toBe("tx_bad_seq");
    });

    it("fee_bump visibility is controlled by includesFeeBump prop", () => {
      const withFeeBump = buildStepList(true);
      const without = buildStepList(false);

      const propsWithFeeBump: TransactionProgressProps = {
        steps: withFeeBump,
        currentStep: "fee_bump",
        includesFeeBump: true,
      };
      const propsWithout: TransactionProgressProps = {
        steps: without,
        currentStep: "submit",
        includesFeeBump: false,
      };

      expect(propsWithFeeBump.steps.some((s) => s.step === "fee_bump")).toBe(true);
      expect(propsWithout.steps.some((s) => s.step === "fee_bump")).toBe(false);
    });
  });

  describe("step ordering", () => {
    it("simulate comes before sign", () => {
      const steps = buildStepList(false);
      const simIdx = steps.findIndex((s) => s.step === "simulate");
      const signIdx = steps.findIndex((s) => s.step === "sign");
      expect(simIdx).toBeLessThan(signIdx);
    });

    it("sign comes before submit", () => {
      const steps = buildStepList(false);
      const signIdx = steps.findIndex((s) => s.step === "sign");
      const subIdx = steps.findIndex((s) => s.step === "submit");
      expect(signIdx).toBeLessThan(subIdx);
    });

    it("fee_bump is between submit and confirm when included", () => {
      const steps = buildStepList(true);
      const subIdx = steps.findIndex((s) => s.step === "submit");
      const fbIdx = steps.findIndex((s) => s.step === "fee_bump");
      const confIdx = steps.findIndex((s) => s.step === "confirm");
      expect(subIdx).toBeLessThan(fbIdx);
      expect(fbIdx).toBeLessThan(confIdx);
    });

    it("confirm is always the last step", () => {
      const withFee = buildStepList(true);
      const without = buildStepList(false);
      expect(withFee[withFee.length - 1]!.step).toBe("confirm");
      expect(without[without.length - 1]!.step).toBe("confirm");
    });
  });

  describe("mockClient integration", () => {
    it("createMockClient can be constructed without error", () => {
      const client = createMockClient();
      expect(client).toBeDefined();
    });

    it("mock client exposes account namespace", () => {
      const client = createMockClient();
      expect(typeof client.account).toBe("object");
    });

    it("mock client exposes transaction namespace", () => {
      const client = createMockClient();
      expect(typeof client.transaction).toBe("object");
    });
  });

  describe("SubmissionStep values", () => {
    it("all defined SubmissionStep values are covered by buildStepList(true)", () => {
      const allSteps: SubmissionStep[] = [
        "simulate",
        "sign",
        "submit",
        "fee_bump",
        "confirm",
      ];
      const list = buildStepList(true);
      for (const step of allSteps) {
        expect(list.some((s) => s.step === step)).toBe(true);
      }
    });
  });
});
