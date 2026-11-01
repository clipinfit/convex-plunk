import { Plunk } from "@clipin/convex-plunk";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
export const plunk = new Plunk(components.plunk, {
  testMode: process.env.PLUNK_TEST_MODE !== "false",
});
export const deliver = plunk.worker();
export const enqueue = internalMutation({
  args: {
    key: v.string(),
    to: v.string(),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string> =>
    plunk.sendEmail(ctx, {
      idempotencyKey: args.key,
      worker: internal.emails.deliver,
      from: process.env.PLUNK_FROM ?? "hello@example.com",
      to: args.to,
      subject: "Convex Plunk example",
      html: "<h1>Hello from Convex Plunk</h1><p>Your email queue is working.</p>",
      scheduledAt: args.scheduledAt,
    }),
});
export const webhook = httpAction(async (ctx, req) =>
  plunk.handleWebhook(ctx, req),
);

// Keep recipient records accessible only through trusted server functions.
export const status = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => plunk.getStatus(ctx, id),
});

export const cancel = internalMutation({
  args: { id: v.string() },
  handler: (ctx, { id }) => plunk.cancel(ctx, id),
});
export const restrict = internalMutation({
  args: {
    email: v.string(),
    blocked: v.boolean(),
    marketingUnsubscribed: v.boolean(),
  },
  handler: (ctx, args) => plunk.setRestriction(ctx, args),
});
export const restriction = internalQuery({
  args: { email: v.string() },
  handler: (ctx, args) => ctx.runQuery(components.plunk.lib.restriction, args),
});
