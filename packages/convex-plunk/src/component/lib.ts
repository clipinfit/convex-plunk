import type { FunctionHandle } from "convex/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

function workerHandle(value: string): FunctionHandle<"action", { id: string }> {
  if (!value.startsWith("function://"))
    throw new Error("Invalid worker function handle");
  // Convex serializes handles as strings. Validate the prefix at this framework boundary.
  return value as FunctionHandle<"action", { id: string }>;
}

import { isEmail } from "../client/transport.js";
import { internal } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import { message } from "./schema.js";

function normalize(email: string) {
  return email.trim().toLowerCase();
}
const idArg = { id: v.id("emails") };
export const enqueue = mutation({
  args: {
    key: v.string(),
    message,
    worker: v.string(),
    testMode: v.boolean(),
    scheduledAt: v.number(),
    intervalMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (!args.key.trim() || args.key.length > 200)
      throw new Error("Provide a key of 1–200 characters");
    if (
      !Number.isFinite(args.scheduledAt) ||
      !Number.isFinite(args.intervalMs) ||
      args.intervalMs < 100
    )
      throw new Error("Invalid scheduling configuration");
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const normalized = { ...args.message, to: normalize(args.message.to) };
    if (existing) {
      if (
        JSON.stringify(existing.message) !== JSON.stringify(normalized) ||
        existing.testMode !== args.testMode ||
        existing.worker !== args.worker
      )
        throw new Error("Idempotency key conflicts with another message");
      return existing._id;
    }
    const now = Date.now();
    const slot = await ctx.db.query("slots").first();
    const scheduledAt =
      args.scheduledAt > now
        ? args.scheduledAt
        : Math.max(now, slot?.nextAt ?? 0);
    // A future notification must not reserve today's entire dispatch queue.
    if (args.scheduledAt <= now) {
      if (slot)
        await ctx.db.patch(slot._id, { nextAt: scheduledAt + args.intervalMs });
      else
        await ctx.db.insert("slots", { nextAt: scheduledAt + args.intervalMs });
    }
    const id = await ctx.db.insert("emails", {
      key: args.key,
      message: normalized,
      worker: args.worker,
      intervalMs: args.intervalMs,
      testMode: args.testMode,
      state: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      scheduledAt,
    });
    const jobId = await ctx.scheduler.runAt(
      scheduledAt,
      workerHandle(args.worker),
      { id },
    );
    await ctx.db.patch(id, { jobId });
    await ctx.scheduler.runAt(scheduledAt + 60000, internal.lib.recover, {
      id,
      attempts: 0,
    });
    return id;
  },
});
export const get = query({
  args: idArg,
  handler: async (ctx, { id }) => ctx.db.get(id),
});
export const claim = mutation({
  args: idArg,
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.state !== "queued" || row.scheduledAt > Date.now()) return null;
    const restriction = await ctx.db
      .query("restrictions")
      .withIndex("by_email", (q) => q.eq("email", row.message.to))
      .unique();
    if (restriction?.blocked) {
      await ctx.db.patch(id, { state: "suppressed", updatedAt: Date.now() });
      return null;
    }
    const dispatch = await ctx.db.query("dispatch").first();
    if (dispatch && dispatch.nextAt > Date.now()) {
      const jobId = await ctx.scheduler.runAt(
        dispatch.nextAt,
        workerHandle(row.worker),
        { id },
      );
      await ctx.db.patch(id, { scheduledAt: dispatch.nextAt, jobId });
      await ctx.scheduler.runAt(dispatch.nextAt + 60000, internal.lib.recover, {
        id,
        attempts: row.attempts,
      });
      return null;
    }
    if (dispatch)
      await ctx.db.patch(dispatch._id, { nextAt: Date.now() + row.intervalMs });
    else
      await ctx.db.insert("dispatch", { nextAt: Date.now() + row.intervalMs });
    const token = row.attempts + 1;
    await ctx.db.patch(id, {
      state: "processing",
      attempts: token,
      token,
      firstAttemptAt: row.firstAttemptAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(60000, internal.lib.expire, { id, token });
    return { ...row, token };
  },
});
export const expire = internalMutation({
  args: { ...idArg, token: v.number() },
  handler: async (ctx, { id, token }) => {
    const row = await ctx.db.get(id);
    if (row?.state === "processing" && row.token === token)
      await ctx.db.patch(id, {
        state: "uncertain",
        error: "Worker lease expired; reconcile before resending",
        updatedAt: Date.now(),
      });
  },
});
export const finish = mutation({
  args: {
    ...idArg,
    token: v.number(),
    outcome: v.union(
      v.object({ kind: v.literal("accepted"), providerId: v.string() }),
      v.object({ kind: v.literal("test") }),
      v.object({ kind: v.literal("retry"), delayMs: v.number() }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
      v.object({ kind: v.literal("uncertain"), error: v.string() }),
    ),
  },
  handler: async (ctx, { id, token, outcome }) => {
    const row = await ctx.db.get(id);
    if (!row || row.token !== token || row.state !== "processing") return;
    const now = Date.now();
    if (outcome.kind === "retry") {
      if (
        row.attempts >= 5 ||
        now - (row.firstAttemptAt ?? now) > 23 * 60 * 60 * 1000
      ) {
        await ctx.db.patch(id, {
          state: "failed",
          error: "Rate-limit retry budget exhausted",
          updatedAt: now,
        });
        return;
      }
      const slot = await ctx.db.query("slots").first();
      const at = Math.max(
        now + Math.min(Math.max(outcome.delayMs, 1000), 3600000),
        slot?.nextAt ?? 0,
      );
      if (slot) await ctx.db.patch(slot._id, { nextAt: at + row.intervalMs });
      const jobId = await ctx.scheduler.runAt(at, workerHandle(row.worker), {
        id,
      });
      await ctx.db.patch(id, {
        state: "queued",
        scheduledAt: at,
        jobId,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(at + 60000, internal.lib.recover, {
        id,
        attempts: row.attempts,
      });
      return;
    }
    const earlyDelivery =
      outcome.kind === "accepted"
        ? await ctx.db
            .query("events")
            .withIndex("by_provider", (q) =>
              q.eq("providerId", outcome.providerId),
            )
            .filter((q) =>
              q.and(
                q.eq(q.field("type"), "email.delivery"),
                q.eq(q.field("email"), row.message.to),
              ),
            )
            .first()
        : null;
    await ctx.db.patch(id, {
      state: earlyDelivery ? "delivered" : outcome.kind,
      updatedAt: now,
      ...(outcome.kind === "accepted"
        ? { providerId: outcome.providerId }
        : {}),
      ...("error" in outcome ? { error: outcome.error } : {}),
    });
  },
});
export const cancel = mutation({
  args: idArg,
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.state !== "queued") return false;
    if (row.jobId) await ctx.scheduler.cancel(row.jobId);
    await ctx.db.patch(id, { state: "cancelled", updatedAt: Date.now() });
    return true;
  },
});
export const restrict = mutation({
  args: {
    email: v.string(),
    blocked: v.boolean(),
    marketingUnsubscribed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const email = normalize(args.email);
    if (!isEmail(email)) throw new Error("Invalid recipient email");
    const row = await ctx.db
      .query("restrictions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const value = { ...args, email, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("restrictions", value);
  },
});
export const restriction = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db
      .query("restrictions")
      .withIndex("by_email", (q) => q.eq("email", normalize(email)))
      .unique(),
});
export const event = mutation({
  args: {
    key: v.string(),
    type: v.string(),
    providerId: v.optional(v.string()),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      await ctx.db
        .query("events")
        .withIndex("by_key", (q) => q.eq("key", args.key))
        .unique()
    )
      return false;
    const email = normalize(args.email);
    await ctx.db.insert("events", { ...args, email, receivedAt: Date.now() });
    if (
      args.type === "email.complaint" ||
      args.type === "email.bounce" ||
      args.type === "contact.unsubscribed"
    ) {
      const existing = await ctx.db
        .query("restrictions")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      const value = {
        email,
        blocked:
          existing?.blocked === true || args.type !== "contact.unsubscribed",
        marketingUnsubscribed: true,
        updatedAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("restrictions", value);
    }
    if (args.providerId) {
      const row = await ctx.db
        .query("emails")
        .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
        .unique();
      if (row && row.message.to === email && args.type === "email.delivery")
        await ctx.db.patch(row._id, {
          state: "delivered",
          updatedAt: Date.now(),
        });
    }
    return true;
  },
});
export const cleanup = mutation({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    if (!Number.isFinite(before) || before > Date.now() - 86400000)
      throw new Error("Retain deduplication records for at least 24 hours");
    let removed = 0;
    for (const state of [
      "accepted",
      "delivered",
      "failed",
      "test",
      "cancelled",
      "suppressed",
    ] as const) {
      const rows = await ctx.db
        .query("emails")
        .withIndex("by_state_updated", (q) =>
          q.eq("state", state).lt("updatedAt", before),
        )
        .take(50);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return removed;
  },
});

export const recover = internalMutation({
  args: { ...idArg, attempts: v.number() },
  handler: async (ctx, { id, attempts }) => {
    const row = await ctx.db.get(id);
    if (
      row?.state !== "queued" ||
      row.attempts !== attempts ||
      row.scheduledAt + 60000 > Date.now()
    )
      return;
    if ((row.recoveries ?? 0) >= 5) {
      await ctx.db.patch(id, {
        state: "failed",
        error: "Worker did not claim after five recoveries",
        updatedAt: Date.now(),
      });
      return;
    }
    // Scheduled actions can fail before their first mutation. No claim means no send occurred.
    const at = Date.now() + 1000;
    const jobId = await ctx.scheduler.runAt(at, workerHandle(row.worker), {
      id,
    });
    await ctx.db.patch(id, {
      jobId,
      scheduledAt: at,
      recoveries: (row.recoveries ?? 0) + 1,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAt(at + 60000, internal.lib.recover, {
      id,
      attempts,
    });
  },
});
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    ctx.db.query("emails").order("desc").paginate(args.paginationOpts),
});
export const resolveUncertain = mutation({
  args: {
    ...idArg,
    resolution: v.union(
      v.object({ kind: v.literal("accepted"), providerId: v.string() }),
      v.object({ kind: v.literal("failed"), reason: v.string() }),
    ),
  },
  handler: async (ctx, { id, resolution }) => {
    const row = await ctx.db.get(id);
    if (row?.state !== "uncertain")
      throw new Error("Only uncertain records can be reconciled");
    if (resolution.kind === "accepted") {
      if (!resolution.providerId.trim())
        throw new Error("Provide a provider ID");
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_provider", (q) =>
          q.eq("providerId", resolution.providerId),
        )
        .unique();
      if (existing && existing._id !== id)
        throw new Error("Provider ID belongs to another record");
      const delivery = await ctx.db
        .query("events")
        .withIndex("by_provider", (q) =>
          q.eq("providerId", resolution.providerId),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("type"), "email.delivery"),
            q.eq(q.field("email"), row.message.to),
          ),
        )
        .first();
      await ctx.db.patch(id, {
        state: delivery ? "delivered" : "accepted",
        providerId: resolution.providerId,
        error: undefined,
        updatedAt: Date.now(),
      });
    } else
      await ctx.db.patch(id, {
        state: "failed",
        error: resolution.reason,
        updatedAt: Date.now(),
      });
  },
});
