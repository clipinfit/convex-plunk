/// <reference types="vite/client" />

import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  components,
  internal,
} from "../../../example-backend/convex/_generated/api.js";
import { Plunk } from "../client/index.js";
import { register } from "../test.js";

const modules = import.meta.glob("../../../example-backend/convex/**/*.ts");
const message = {
  from: "hello@example.com",
  to: "reader@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
};
function setup() {
  vi.useFakeTimers();
  const t = convexTest(defineSchema({}), modules);
  register(t);
  return t;
}
async function enqueue(
  t: ReturnType<typeof setup>,
  key = "one",
  testMode = true,
  scheduledAt?: number,
) {
  return t.mutation(components.plunk.lib.enqueue, {
    key,
    message,
    worker: await t.run(async () => {
      const { createFunctionHandle } = await import("convex/server");
      return createFunctionHandle(internal.emails.deliver);
    }),
    testMode,
    scheduledAt: scheduledAt ?? Date.now(),
    intervalMs: 1000,
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("durable component", () => {
  it("queues once per business key and rejects changed content", async () => {
    const t = setup();
    const id = await enqueue(t);
    expect(await enqueue(t)).toBe(id);
    const row = await t.query(components.plunk.lib.get, { id });
    expect(row?.attempts).toBe(0);
    await expect(
      t.mutation(components.plunk.lib.enqueue, {
        key: "one",
        message: { ...message, subject: "Changed" },
        worker: row?.worker ?? "",
        testMode: true,
        scheduledAt: Date.now(),
        intervalMs: 1000,
      }),
    ).rejects.toThrow("conflicts");
  });
  it("runs the exported host worker in test mode without credentials or network", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = setup();
    const id = await t.mutation(internal.emails.enqueue, {
      key: "host",
      to: message.to,
    });
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "test",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels queued work", async () => {
    const t = setup();
    const id = await enqueue(t);
    expect(await t.mutation(components.plunk.lib.cancel, { id })).toBe(true);
    expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
  });
  it("reserves paced slots and waits until the due time", async () => {
    const t = setup();
    await enqueue(t, "a");
    const id = await enqueue(t, "b");
    expect(
      (await t.query(components.plunk.lib.get, { id }))?.scheduledAt,
    ).toBeGreaterThan(Date.now());
    expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
  });
  it("rejects a second claim for a processing record", async () => {
    const t = setup();
    const id = await enqueue(t);
    expect(await t.mutation(components.plunk.lib.claim, { id })).not.toBeNull();
    expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
  });
  it("suppresses blocked transactional recipients", async () => {
    const t = setup();
    await t.mutation(components.plunk.lib.restrict, {
      email: message.to,
      blocked: true,
      marketingUnsubscribed: true,
    });
    const id = await enqueue(t);
    expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "suppressed",
    );
  });
  it("does not treat marketing-only unsubscribe as a transactional block", async () => {
    const t = setup();
    await t.mutation(components.plunk.lib.restrict, {
      email: message.to,
      blocked: false,
      marketingUnsubscribed: true,
    });
    const id = await enqueue(t);
    expect(await t.mutation(components.plunk.lib.claim, { id })).not.toBeNull();
  });
  it("retries 429 with the same row and rejects stale completion tokens", async () => {
    const t = setup();
    const id = await enqueue(t);
    const row = await t.mutation(components.plunk.lib.claim, { id });
    expect(row).not.toBeNull();
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: row?.token ?? 0,
      outcome: { kind: "retry", delayMs: 30000 },
    });
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "queued",
    );
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: 999,
      outcome: { kind: "accepted", providerId: "wrong" },
    });
    expect(
      (await t.query(components.plunk.lib.get, { id }))?.providerId,
    ).toBeUndefined();
  });
  it("records delivery feedback and never resubscribes on a subscribe event", async () => {
    const t = setup();
    const id = await enqueue(t);
    await t.mutation(components.plunk.lib.claim, { id });
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: 1,
      outcome: { kind: "accepted", providerId: "p1" },
    });
    const event = {
      key: "event-1",
      type: "email.delivery",
      email: message.to,
      providerId: "p1",
    };
    expect(await t.mutation(components.plunk.lib.event, event)).toBe(true);
    expect(await t.mutation(components.plunk.lib.event, event)).toBe(false);
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "delivered",
    );
    await t.mutation(components.plunk.lib.event, {
      key: "denial",
      type: "email.complaint",
      email: message.to,
    });
    await t.mutation(components.plunk.lib.event, {
      key: "subscribe",
      type: "contact.subscribed",
      email: message.to,
    });
    expect(
      (await t.query(components.plunk.lib.restriction, { email: message.to }))
        ?.blocked,
    ).toBe(true);
  });
  it("expires a crashed worker into uncertain rather than resending", async () => {
    vi.useFakeTimers();
    const t = setup();
    const id = await enqueue(t);
    await t.mutation(components.plunk.lib.claim, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "uncertain",
    );
  });
  it("authenticates webhooks before parsing and rejects unknown envelopes", async () => {
    const t = setup();
    const plunk = new Plunk(components.plunk, { webhookSecret: "test-secret" });
    const request = (body: string, authorized = true) =>
      new Request("https://example.com/plunk", {
        method: "POST",
        headers: authorized ? { authorization: "Bearer test-secret" } : {},
        body,
      });
    expect(
      await t.run(
        async (ctx) =>
          (await plunk.handleWebhook(ctx, request("bad", false))).status,
      ),
    ).toBe(401);
    expect(
      await t.run(
        async (ctx) => (await plunk.handleWebhook(ctx, request("bad"))).status,
      ),
    ).toBe(400);
    expect(
      await t.run(
        async (ctx) =>
          (
            await plunk.handleWebhook(
              ctx,
              request(
                JSON.stringify({
                  type: "contact.unsubscribed",
                  contact: { email: message.to },
                  event: {},
                }),
              ),
            )
          ).status,
      ),
    ).toBe(204);
    expect(
      (await t.query(components.plunk.lib.restriction, { email: message.to }))
        ?.marketingUnsubscribed,
    ).toBe(true);
  });
  it("retains uncertain rows during cleanup", async () => {
    const t = setup();
    await expect(
      t.mutation(components.plunk.lib.cleanup, { before: Date.now() }),
    ).rejects.toThrow("24 hours");
  });
});
describe("failure recovery", () => {
  it("submits through the host worker with mocked HTTP and keeps credentials out of records", async () => {
    vi.stubEnv("PLUNK_API_KEY", "test-only-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        data: { emails: [{ email: "live-fixture-id" }] },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const t = setup();
    const id = await enqueue(t, "live", false);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const row = await t.query(components.plunk.lib.get, { id });
    expect(row?.state).toBe("accepted");
    expect(row?.providerId).toBe("live-fixture-id");
    expect(JSON.stringify(row)).not.toContain("test-only-key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
  it("records delivery events that arrive before send completion", async () => {
    const t = setup();
    const id = await enqueue(t);
    await t.mutation(components.plunk.lib.claim, { id });
    await t.mutation(components.plunk.lib.event, {
      key: "early-delivery",
      type: "email.delivery",
      email: message.to,
      providerId: "early-id",
    });
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: 1,
      outcome: { kind: "accepted", providerId: "early-id" },
    });
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "delivered",
    );
  });
  it("requires reconciliation before an uncertain record changes state", async () => {
    const t = setup();
    const id = await enqueue(t);
    await t.mutation(components.plunk.lib.claim, { id });
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: 1,
      outcome: { kind: "uncertain", error: "timeout" },
    });
    expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
    await t.mutation(components.plunk.lib.resolveUncertain, {
      id,
      resolution: { kind: "accepted", providerId: "reconciled-id" },
    });
    expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
      "accepted",
    );
  });
});

it("a future scheduled message does not block an immediate message", async () => {
  const t = setup();
  await enqueue(t, "future", true, Date.now() + 86400000);
  const id = await enqueue(t, "immediate");
  expect(
    (await t.query(components.plunk.lib.get, { id }))?.scheduledAt,
  ).toBeLessThan(Date.now() + 1000);
});

it("keeps uncertain records and restrictions while removing old completed records", async () => {
  const t = setup();
  const completed = await enqueue(t, "completed");
  await t.mutation(components.plunk.lib.claim, { id: completed });
  await t.mutation(components.plunk.lib.finish, {
    id: completed,
    token: 1,
    outcome: { kind: "test" },
  });
  vi.setSystemTime(Date.now() + 1001);
  const uncertain = await enqueue(t, "uncertain");
  await t.mutation(components.plunk.lib.claim, { id: uncertain });
  await t.mutation(components.plunk.lib.finish, {
    id: uncertain,
    token: 1,
    outcome: { kind: "uncertain", error: "timeout" },
  });
  await t.mutation(components.plunk.lib.restrict, {
    email: message.to,
    blocked: true,
    marketingUnsubscribed: true,
  });
  vi.setSystemTime(Date.now() + 7 * 86400000);
  expect(
    await t.mutation(components.plunk.lib.cleanup, {
      before: Date.now() - 86400001,
    }),
  ).toBe(1);
  expect(await t.query(components.plunk.lib.get, { id: completed })).toBeNull();
  expect(
    (await t.query(components.plunk.lib.get, { id: uncertain }))?.state,
  ).toBe("uncertain");
  expect(
    (await t.query(components.plunk.lib.restriction, { email: message.to }))
      ?.blocked,
  ).toBe(true);
});
it("stops rate-limit retries after five claims", async () => {
  const t = setup();
  const id = await enqueue(t);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const row = await t.mutation(components.plunk.lib.claim, { id });
    expect(row?.token).toBe(attempt);
    await t.mutation(components.plunk.lib.finish, {
      id,
      token: attempt,
      outcome: { kind: "retry", delayMs: 1000 },
    });
    vi.setSystemTime(Date.now() + 1001);
  }
  expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
    "failed",
  );
  expect(await t.mutation(components.plunk.lib.claim, { id })).toBeNull();
});
it("cannot cancel a claimed email", async () => {
  const t = setup();
  const id = await enqueue(t);
  await t.mutation(components.plunk.lib.claim, { id });
  expect(await t.mutation(components.plunk.lib.cancel, { id })).toBe(false);
});
it("records a missing API key as failed without network access", async () => {
  vi.stubEnv("PLUNK_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const t = setup();
  const id = await enqueue(t, "missing-key", false);
  vi.advanceTimersByTime(0);
  await t.finishInProgressScheduledFunctions();
  expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
    "failed",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("preserves an early delivery event during manual reconciliation", async () => {
  const t = setup();
  const id = await enqueue(t);
  await t.mutation(components.plunk.lib.claim, { id });
  await t.mutation(components.plunk.lib.finish, {
    id,
    token: 1,
    outcome: { kind: "uncertain", error: "timeout" },
  });
  await t.mutation(components.plunk.lib.event, {
    key: "delivery-before-reconcile",
    type: "email.delivery",
    email: message.to,
    providerId: "confirmed",
  });
  await t.mutation(components.plunk.lib.resolveUncertain, {
    id,
    resolution: { kind: "accepted", providerId: "confirmed" },
  });
  expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
    "delivered",
  );
});
it("does not correlate a delivery event for another recipient", async () => {
  const t = setup();
  const id = await enqueue(t);
  await t.mutation(components.plunk.lib.claim, { id });
  await t.mutation(components.plunk.lib.finish, {
    id,
    token: 1,
    outcome: { kind: "accepted", providerId: "p1" },
  });
  await t.mutation(components.plunk.lib.event, {
    key: "wrong-recipient",
    type: "email.delivery",
    email: "other@example.com",
    providerId: "p1",
  });
  expect((await t.query(components.plunk.lib.get, { id }))?.state).toBe(
    "accepted",
  );
});
it("rejects oversized UTF-8 webhook bodies before processing events", async () => {
  const t = setup();
  const plunk = new Plunk(components.plunk, { webhookSecret: "test-secret" });
  const response = await t.run(
    async (ctx) =>
      (
        await plunk.handleWebhook(
          ctx,
          new Request("https://example.com/webhook", {
            method: "POST",
            headers: { authorization: "Bearer test-secret" },
            body: "😀".repeat(17000),
          }),
        )
      ).status,
  );
  expect(response).toBe(413);
});
