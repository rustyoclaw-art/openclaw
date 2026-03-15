import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTasksCancelParams,
  validateTasksDispatchParams,
} from "../protocol/index.js";
import type {
  TasksCancelResult,
  TasksDispatchResult,
  TaskStatus,
} from "../protocol/schema/tasks.js";
import type { GatewayRequestHandlers } from "./types.js";

// ── In-process task store ──────────────────────────────────────────────────
//
// Tasks are intentionally ephemeral: they live for the lifetime of the
// gateway process.  This is sufficient for the idempotency contract:
// duplicate calls within the same gateway session are deduplicated;
// callers should not rely on tasks surviving a gateway restart.

interface TaskEntry {
  task_id: string;
  agent_id: string;
  context_md?: string;
  idempotency_key?: string;
  status: TaskStatus;
  created_at_ms: number;
}

/** task_id → TaskEntry */
const taskById = new Map<string, TaskEntry>();
/** idempotency_key → task_id */
const taskIdByIdempotencyKey = new Map<string, string>();

/** Terminal statuses — tasks in these states are not reused for idempotency. */
const TERMINAL_STATUSES = new Set<TaskStatus>(["done", "cancelled", "failed"]);

// Exported for tests to reset module-level state between cases.
export function _resetTaskStoreForTest(): void {
  taskById.clear();
  taskIdByIdempotencyKey.clear();
}

// ── Handlers ──────────────────────────────────────────────────────────────

export const tasksHandlers: GatewayRequestHandlers = {
  /**
   * tasks.dispatch
   *
   * Registers a caller-supplied task_id as dispatched and returns it.
   * Idempotency rules (checked in order):
   *   1. If task_id already maps to a live task → return it (`created: false`).
   *   2. If idempotency_key maps to a live task → return that task (`created: false`).
   *   3. Otherwise create a new entry and return it (`created: true`).
   */
  "tasks.dispatch": ({ params, respond }) => {
    if (!validateTasksDispatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.dispatch params: ${formatValidationErrors(validateTasksDispatchParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as {
      task_id: string;
      agent_id: string;
      context_md?: string;
      idempotency_key?: string;
    };

    // Idempotency check 1: task_id already live.
    const existingById = taskById.get(p.task_id);
    if (existingById && !TERMINAL_STATUSES.has(existingById.status)) {
      respond(true, toDispatchResult(existingById, false), undefined);
      return;
    }

    // Idempotency check 2: idempotency_key maps to a live task.
    if (p.idempotency_key) {
      const existingId = taskIdByIdempotencyKey.get(p.idempotency_key);
      if (existingId) {
        const existing = taskById.get(existingId);
        if (existing && !TERMINAL_STATUSES.has(existing.status)) {
          respond(true, toDispatchResult(existing, false), undefined);
          return;
        }
        // Previous task with this key is terminal — allow re-use.
        taskIdByIdempotencyKey.delete(p.idempotency_key);
      }
    }

    const task: TaskEntry = {
      task_id: p.task_id,
      agent_id: p.agent_id,
      context_md: p.context_md,
      idempotency_key: p.idempotency_key,
      status: "queued",
      created_at_ms: Date.now(),
    };

    taskById.set(task.task_id, task);
    if (task.idempotency_key) {
      taskIdByIdempotencyKey.set(task.idempotency_key, task.task_id);
    }

    respond(true, toDispatchResult(task, true), undefined);
  },

  /**
   * tasks.cancel
   *
   * Cancels a queued or running task by task_id.  Cancelling a task that is
   * already in a terminal state succeeds with `cancelled: false` (idempotent).
   */
  "tasks.cancel": ({ params, respond }) => {
    if (!validateTasksCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.cancel params: ${formatValidationErrors(validateTasksCancelParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as { task_id: string };
    const task = taskById.get(p.task_id);

    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tasks.cancel: task not found", {
          details: { subcode: "not_found" },
        }),
      );
      return;
    }

    const previous_status = task.status;

    // Idempotent: already terminal — report without error.
    if (TERMINAL_STATUSES.has(task.status)) {
      const result: TasksCancelResult = {
        task_id: task.task_id,
        cancelled: false,
        previous_status,
      };
      respond(true, result, undefined);
      return;
    }

    task.status = "cancelled";

    const result: TasksCancelResult = { task_id: task.task_id, cancelled: true, previous_status };
    respond(true, result, undefined);
  },
};

function toDispatchResult(task: TaskEntry, created: boolean): TasksDispatchResult {
  return {
    task_id: task.task_id,
    agent_id: task.agent_id,
    status: task.status,
    created,
    created_at_ms: task.created_at_ms,
    idempotency_key: task.idempotency_key,
  };
}
