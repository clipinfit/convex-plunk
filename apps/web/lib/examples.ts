export const examples = [
  {
    name: "Mount",
    file: "convex/convex.config.ts",
    code: `import { defineApp } from "convex/server";
import plunk from "@clipin/convex-plunk/convex.config.js";

const app = defineApp();
app.use(plunk);
export default app;`,
  },
  {
    name: "Queue",
    file: "convex/emails.ts",
    code: `import { Plunk } from "@clipin/convex-plunk";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const plunk = new Plunk(components.plunk); // test mode
export const deliver = plunk.worker();

export const welcome = internalMutation({
  args: {},
  handler: async (ctx): Promise<string> =>
    plunk.sendEmail(ctx, {
      worker: internal.emails.deliver,
      idempotencyKey: "welcome:user-123:v1",
      from: "hello@example.com",
      to: "reader@example.com",
      subject: "Welcome aboard",
      html: "<p>Your workspace is ready.</p>",
    }),
});`,
  },
  {
    name: "Schedule",
    file: "Inside your internal mutation",
    code: `// Use the same Plunk instance and worker.
const emailId = await plunk.sendEmail(ctx, {
  worker: internal.emails.deliver,
  idempotencyKey: "reminder:event-123:v1",
  from: "hello@example.com",
  to: "reader@example.com",
  subject: "Your reminder",
  html: "<p>Time to get started.</p>",
  scheduledAt: Date.now() + 60 * 60 * 1000,
});

// Cancel only while the message is still queued.
await plunk.cancel(ctx, emailId);`,
  },
];
