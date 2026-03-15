import { beforeEach, describe, expect, it } from "vitest";
import { _resetTaskStoreForTest, tasksHandlers } from "./tasks.js";

type RespondCall = [boolean, unknown?, { code?: string; message?: string; details?: unknown }?];

function makeDispatchOpts(params: Record<string, unknown>) {
  return {
    params,
    respond: (() => {}) as never,
    client: null,
    context: {} as never,
    req: { type: "req" as const, id: "req-tasks-dispatch", method: "tasks.dispatch" },
    isWebchatConnect: () => false,
  };
}

function makeCancelOpts(params: Record<string, unknown>) {
  return {
    params,
    respond: (() => {}) as never,
    client: null,
    context: {} as never,
    req: { type: "req" as const, id: "req-tasks-cancel", method: "tasks.cancel" },
    isWebchatConnect: () => false,
  };
}

describe("tasks.dispatch", () => {
  beforeEach(() => _resetTaskStoreForTest());

  it("creates a new task and returns created:true", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({ task_id: "task-abc", agent_id: "agent-1" }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });

    expect(calls).toHaveLength(1);
    const [ok, result] = calls[0];
    expect(ok).toBe(true);
    expect(result).toMatchObject({
      task_id: "task-abc",
      agent_id: "agent-1",
      status: "queued",
      created: true,
    });
    expect(typeof (result as { created_at_ms: number }).created_at_ms).toBe("number");
  });

  it("stores optional context_md", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({
        task_id: "task-ctx",
        agent_id: "agent-1",
        context_md: "## Goal\nDo the thing.",
      }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(true);
    expect(calls[0][1]).toMatchObject({ task_id: "task-ctx", created: true });
  });

  it("returns validation error for missing required fields", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({}),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
  });

  it("returns validation error for missing agent_id", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({ task_id: "task-1" }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
  });

  it("returns validation error for unknown extra properties", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({ task_id: "task-1", agent_id: "agent-1", bogus: true }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
  });

  describe("idempotency by task_id", () => {
    it("returns the existing task on duplicate task_id (created:false)", async () => {
      const calls1: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({ task_id: "task-idem", agent_id: "agent-1" }),
        respond: ((...args: unknown[]) => calls1.push(args as RespondCall)) as never,
      });
      expect((calls1[0][1] as { created: boolean }).created).toBe(true);

      const calls2: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({ task_id: "task-idem", agent_id: "agent-1" }),
        respond: ((...args: unknown[]) => calls2.push(args as RespondCall)) as never,
      });
      const second = calls2[0][1] as { task_id: string; created: boolean };
      expect(second.created).toBe(false);
      expect(second.task_id).toBe("task-idem");
    });
  });

  describe("idempotency by idempotency_key", () => {
    it("returns the existing task when idempotency_key matches a live task (created:false)", async () => {
      const calls1: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({ task_id: "task-k1", agent_id: "agent-1", idempotency_key: "idem-1" }),
        respond: ((...args: unknown[]) => calls1.push(args as RespondCall)) as never,
      });
      expect((calls1[0][1] as { created: boolean }).created).toBe(true);

      // Different task_id, same idempotency_key → should return existing.
      const calls2: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({ task_id: "task-k2", agent_id: "agent-1", idempotency_key: "idem-1" }),
        respond: ((...args: unknown[]) => calls2.push(args as RespondCall)) as never,
      });
      const second = calls2[0][1] as { task_id: string; created: boolean };
      expect(second.created).toBe(false);
      expect(second.task_id).toBe("task-k1");
    });

    it("allows re-use of idempotency_key after task reaches terminal state", async () => {
      const calls1: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({
          task_id: "task-reuse-1",
          agent_id: "agent-1",
          idempotency_key: "idem-reuse",
        }),
        respond: ((...args: unknown[]) => calls1.push(args as RespondCall)) as never,
      });

      await tasksHandlers["tasks.cancel"]({
        ...makeCancelOpts({ task_id: "task-reuse-1" }),
        respond: (() => {}) as never,
      });

      // Dispatch new task_id with the same idempotency_key — should create fresh task.
      const calls2: RespondCall[] = [];
      await tasksHandlers["tasks.dispatch"]({
        ...makeDispatchOpts({
          task_id: "task-reuse-2",
          agent_id: "agent-1",
          idempotency_key: "idem-reuse",
        }),
        respond: ((...args: unknown[]) => calls2.push(args as RespondCall)) as never,
      });
      const second = calls2[0][1] as { task_id: string; created: boolean };
      expect(second.created).toBe(true);
      expect(second.task_id).toBe("task-reuse-2");
    });
  });
});

describe("tasks.cancel", () => {
  beforeEach(() => _resetTaskStoreForTest());

  async function dispatchTask(task_id: string, agent_id = "agent-1"): Promise<void> {
    await tasksHandlers["tasks.dispatch"]({
      ...makeDispatchOpts({ task_id, agent_id }),
      respond: (() => {}) as never,
    });
  }

  it("cancels a queued task (cancelled:true, previous_status:queued)", async () => {
    await dispatchTask("task-cancel-1");
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({ task_id: "task-cancel-1" }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(true);
    expect(calls[0][1]).toMatchObject({
      task_id: "task-cancel-1",
      cancelled: true,
      previous_status: "queued",
    });
  });

  it("is idempotent: cancelling an already-cancelled task returns cancelled:false without error", async () => {
    await dispatchTask("task-cancel-2");
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({ task_id: "task-cancel-2" }),
      respond: (() => {}) as never,
    });
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({ task_id: "task-cancel-2" }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(true);
    expect((calls[0][1] as { cancelled: boolean }).cancelled).toBe(false);
    expect((calls[0][1] as { previous_status: string }).previous_status).toBe("cancelled");
  });

  it("returns INVALID_REQUEST with subcode not_found when task does not exist", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({ task_id: "no-such-task" }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
    expect((calls[0][2]?.details as { subcode?: string })?.subcode).toBe("not_found");
  });

  it("returns validation error when task_id is missing", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({}),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
  });

  it("returns validation error when task_id is wrong type", async () => {
    const calls: RespondCall[] = [];
    await tasksHandlers["tasks.cancel"]({
      ...makeCancelOpts({ task_id: 12345 }),
      respond: ((...args: unknown[]) => calls.push(args as RespondCall)) as never,
    });
    expect(calls[0][0]).toBe(false);
    expect(calls[0][2]?.code).toBe("INVALID_REQUEST");
  });
});
