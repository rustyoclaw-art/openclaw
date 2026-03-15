import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// ── Shared enums ────────────────────────────────────────────────────────────

export const TaskStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("cancelled"),
  Type.Literal("failed"),
]);

// ── tasks.dispatch ──────────────────────────────────────────────────────────

/**
 * Params for tasks.dispatch.  All identifiers follow the Mission Control
 * write-path convention: snake_case field names.
 */
export const TasksDispatchParamsSchema = Type.Object(
  {
    /** Caller-assigned logical task identifier.  Used as primary idempotency key. */
    task_id: NonEmptyString,
    /** ID of the agent this task is dispatched to. */
    agent_id: NonEmptyString,
    /** Optional Markdown-formatted context for the task. */
    context_md: Type.Optional(Type.String()),
    /**
     * Optional secondary idempotency key.  A second dispatch where an existing
     * live task shares this key returns that task unchanged (`created: false`),
     * even if `task_id` differs.
     */
    idempotency_key: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const TasksDispatchResultSchema = Type.Object({
  task_id: NonEmptyString,
  agent_id: NonEmptyString,
  status: TaskStatusSchema,
  /**
   * `true` when a new task was created; `false` when the call was a no-op
   * because an existing live task matched `task_id` or `idempotency_key`.
   */
  created: Type.Boolean(),
  created_at_ms: Type.Number(),
  idempotency_key: Type.Optional(NonEmptyString),
});

// ── tasks.cancel ─────────────────────────────────────────────────────────────

export const TasksCancelParamsSchema = Type.Object(
  {
    /** ID of the task to cancel (as supplied to tasks.dispatch). */
    task_id: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksCancelResultSchema = Type.Object({
  task_id: NonEmptyString,
  /**
   * `true` when the task was transitioned to `cancelled`; `false` when the
   * task was already terminal (idempotent success).
   */
  cancelled: Type.Boolean(),
  previous_status: TaskStatusSchema,
});

// ── tasks.create ─────────────────────────────────────────────────────────────

/**
 * Params for tasks.create.  Unlike tasks.dispatch, agent_id is optional —
 * the caller may assign an agent later.
 */
export const TasksCreateParamsSchema = Type.Object(
  {
    /** Caller-assigned logical task identifier.  Used as primary idempotency key. */
    task_id: NonEmptyString,
    /** Optional ID of the agent this task is assigned to. */
    agent_id: Type.Optional(NonEmptyString),
    /** Optional Markdown-formatted context for the task. */
    context_md: Type.Optional(Type.String()),
    /**
     * Optional secondary idempotency key.  A second create where an existing
     * live task shares this key returns that task unchanged (`created: false`),
     * even if `task_id` differs.
     */
    idempotency_key: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const TasksCreateResultSchema = Type.Object({
  task_id: NonEmptyString,
  agent_id: Type.Optional(NonEmptyString),
  status: TaskStatusSchema,
  /**
   * `true` when a new task was created; `false` when the call was a no-op
   * because an existing live task matched `task_id` or `idempotency_key`.
   */
  created: Type.Boolean(),
  created_at_ms: Type.Number(),
  idempotency_key: Type.Optional(NonEmptyString),
});

// ── TypeScript types ─────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "done" | "cancelled" | "failed";

export type TasksDispatchParams = {
  task_id: string;
  agent_id: string;
  context_md?: string;
  idempotency_key?: string;
};

export type TasksDispatchResult = {
  task_id: string;
  agent_id: string;
  status: TaskStatus;
  created: boolean;
  created_at_ms: number;
  idempotency_key?: string;
};

export type TasksCancelParams = {
  task_id: string;
};

export type TasksCancelResult = {
  task_id: string;
  cancelled: boolean;
  previous_status: TaskStatus;
};

export type TasksCreateParams = {
  task_id: string;
  agent_id?: string;
  context_md?: string;
  idempotency_key?: string;
};

export type TasksCreateResult = {
  task_id: string;
  agent_id?: string;
  status: TaskStatus;
  created: boolean;
  created_at_ms: number;
  idempotency_key?: string;
};
