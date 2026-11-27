import {
  err,
  ok,
  SorokitErrorCode,
} from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { createAuditTrail } from "../compliance/auditTrail";

export interface AtomicOrchestratorOptions {
  /** Retries after the initial attempt, applied to each step independently. */
  maxRetries?: number;
  /** Delay between attempts in milliseconds. Defaults to zero. */
  retryDelayMs?: number;
}

export interface AtomicStepContext {
  completedSteps: number;
  results: readonly unknown[];
}

export interface AtomicFailureContext extends AtomicStepContext {
  failedStepIndex: number;
  failure: unknown;
}

export interface AtomicExecutionResult {
  completedSteps: number;
  results: unknown[];
  attemptsByStep: number[];
  sagaId: string;
}

/**
 * Per-step descriptor that bundles the execute action with an optional
 * compensation callback.
 *
 * The `compensate` callback must be **idempotent** — it may be called more
 * than once if the caller retries a failed compensation. Design compensations
 * so that running them multiple times leaves the system in the same state as
 * running them once (e.g. check whether a resource already no longer exists
 * before attempting to remove it).
 */
export interface AtomicStepDefinition<T = unknown> {
  execute: (context: AtomicStepContext) => T | Promise<T>;
  /**
   * Compensation action invoked when a later step fails.
   * Must be idempotent — it may be called more than once if a compensation
   * itself fails and is retried by the caller.
   */
  compensate?: (context: AtomicStepContext) => void | Promise<void>;
}

export interface SagaCompensationRecord {
  sagaId: string;
  compensationsRun: number;
  compensationFailures: unknown[];
}

type AtomicStep = (context: AtomicStepContext) => unknown | Promise<unknown>;
type FailureHandler = (
  context: AtomicFailureContext,
) => void | Promise<void>;

function isErrorResult(
  value: unknown,
): value is Extract<SorokitResult<unknown>, { status: "error" }> {
  return typeof value === "object" && value !== null &&
    (value as { status?: unknown }).status === "error";
}

let sagaCounter = 0;

function generateSagaId(): string {
  sagaCounter += 1;
  return `saga_${Date.now()}_${sagaCounter}`;
}

/** Sequential orchestration with caller-provided compensation on failure. */
export class AtomicOrchestrator {
  private readonly steps: Array<{ execute: AtomicStep; compensate?: (context: AtomicStepContext) => void | Promise<void> }> = [];
  private failureHandler?: FailureHandler;

  constructor(private readonly options: AtomicOrchestratorOptions = {}) {}

  step<T>(
    operation:
      | ((context: AtomicStepContext) => T | Promise<T>)
      | AtomicStepDefinition<T>,
  ): this {
    if (typeof operation === "function") {
      this.steps.push({ execute: operation });
    } else {
      this.steps.push({ execute: operation.execute, compensate: operation.compensate });
    }
    return this;
  }

  onFailure(handler: FailureHandler): this {
    this.failureHandler = handler;
    return this;
  }

  async execute(): Promise<SorokitResult<AtomicExecutionResult>> {
    const maxRetries = this.options.maxRetries ?? 0;
    const retryDelayMs = this.options.retryDelayMs ?? 0;
    if (
      !Number.isInteger(maxRetries) ||
      maxRetries < 0 ||
      !Number.isFinite(retryDelayMs) ||
      retryDelayMs < 0
    ) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        "Retry limits must be non-negative finite numbers.",
      );
    }
    if (this.steps.length === 0) {
      return err(
        SorokitErrorCode.INVALID_TRANSACTION,
        "At least one orchestration step is required.",
      );
    }

    const sagaId = generateSagaId();
    const auditTrail = createAuditTrail();
    const results: unknown[] = [];
    const attemptsByStep: number[] = [];

    for (let stepIndex = 0; stepIndex < this.steps.length; stepIndex += 1) {
      const { execute: operation } = this.steps[stepIndex]!;
      let failure: unknown;
      let completed = false;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        attemptsByStep[stepIndex] = attempt + 1;
        try {
          const result = await operation({
            completedSteps: results.length,
            results: [...results],
          });
          if (isErrorResult(result)) {
            failure = result.error;
            if (attempt < maxRetries && retryDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
            continue;
          }
          results.push(result);
          completed = true;
          break;
        } catch (cause) {
          failure = cause;
          if (attempt < maxRetries && retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }

      if (completed) continue;

      // Run compensations in reverse order for all completed steps.
      const compensationFailures: unknown[] = [];
      for (let i = results.length - 1; i >= 0; i -= 1) {
        const compensate = this.steps[i]?.compensate;
        if (!compensate) continue;
        try {
          await compensate({
            completedSteps: results.length,
            results: [...results],
          });
        } catch (compensationError) {
          compensationFailures.push(compensationError);
        }
      }

      // Record saga state in the audit trail.
      const sagaRecord: SagaCompensationRecord = {
        sagaId,
        compensationsRun: results.length,
        compensationFailures,
      };
      auditTrail.recordOperation("sagaCompensation", "atomicOrchestrator", {
        sagaId,
        failedStepIndex: stepIndex,
        completedSteps: results.length,
        compensationsRun: sagaRecord.compensationsRun,
        compensationFailureCount: compensationFailures.length,
      });

      const failureContext: AtomicFailureContext = {
        completedSteps: results.length,
        results: [...results],
        failedStepIndex: stepIndex,
        failure,
      };
      let rollbackFailure: unknown;
      if (this.failureHandler) {
        try {
          await this.failureHandler(failureContext);
        } catch (cause) {
          rollbackFailure = cause;
        }
      }

      return err(
        SorokitErrorCode.TX_SUBMIT_FAILED,
        `Orchestration failed at step ${stepIndex}.`,
        { failure, rollbackFailure, completedSteps: results.length, sagaId, compensationsRun: sagaRecord.compensationsRun, compensationFailures },
        undefined,
        {
          context: {
            operation: "atomicOrchestration",
            parameters: {
              failedStepIndex: stepIndex,
              completedSteps: results.length,
              rollbackFailed: rollbackFailure !== undefined,
              sagaId,
              compensationsRun: sagaRecord.compensationsRun,
              compensationFailures: compensationFailures.length,
            },
          },
          recovery: {
            retryable: rollbackFailure === undefined,
            action:
              rollbackFailure === undefined
                ? "Inspect the failed step, then retry the orchestration if safe."
                : "Inspect both the failed step and rollback failure before retrying.",
          },
        },
      );
    }

    return ok({
      completedSteps: results.length,
      results,
      attemptsByStep,
      sagaId,
    });
  }
}

export function orchestrate(
  options: AtomicOrchestratorOptions = {},
): AtomicOrchestrator {
  return new AtomicOrchestrator(options);
}
