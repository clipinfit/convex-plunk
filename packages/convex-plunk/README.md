# @clipin/convex-plunk

Persistent transactional email delivery for Convex and hosted Plunk.

## Mount the component

```ts
import { defineApp } from "convex/server";
import plunk from "@clipin/convex-plunk/convex.config.js";
const app = defineApp();
app.use(plunk);
export default app;
```

## Define the host worker and enqueue a message

```ts
import { Plunk } from "@clipin/convex-plunk";
import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const plunk = new Plunk(components.plunk); // testMode defaults to true
export const deliver = plunk.worker();

export const welcome = internalMutation({
  args: {},
  handler: async (ctx): Promise<string> =>
    plunk.sendEmail(ctx, {
      idempotencyKey: "welcome:user-123:v1",
      worker: internal.emails.deliver,
      from: "hello@example.com",
      to: "reader@example.com",
      subject: "Welcome",
      html: "<p>Welcome.</p>",
    }),
});
```

Use a real business event identifier, not the static example key. Protect any host public mutation with application authorization. Component methods are trusted server APIs, not public user endpoints.

`testMode: true` records a `test` result without HTTP or credentials. To send real email, use `new Plunk(components.plunk, { testMode: false })` and set `PLUNK_API_KEY` in the host Convex deployment. The default API base is `https://next-api.useplunk.com`; `apiBaseUrl` can override it with an HTTPS URL. Confirm the endpoint for your provider account before live use.

Credentials remain in the host worker runtime. They are not stored in outbox records or scheduled arguments. Mount one component per Plunk project. Keep queueing and worker configuration on the same instance.

The accepted message fields are plain-address `from`, one `to`, `subject`, `html`, optional single `replyTo`, and optional header map. React Email can render the HTML in a Node action before queueing. Local React Email previews are independent of the provider. Plunk generates the text alternative; there is no `text` override here. Attachments, display-name senders, provider templates, and campaigns are not implemented by this component.

## Scheduling and results

Pass a future Unix timestamp in milliseconds as `scheduledAt`. Local Convex scheduling has one owner; the adapter does not also schedule with the provider. `sendEmail` returns a component record ID, not proof of delivery.

- `plunk.getStatus(ctx, id)` reads the record.
- `plunk.cancel(ctx, id)` cancels queued work only.
- `components.plunk.lib.list` provides paginated server-side inspection.
- `components.plunk.lib.resolveUncertain` records verified provider acceptance or a confirmed failure. It does not resend.

Default spacing is 1,000 milliseconds. The minimum is 100 milliseconds. Set a slower `intervalMs` if your project requires it. Admission reservations and a dispatch gate spread sends. Concurrent calls cannot claim the same row. This does not override provider quotas or guarantee a specific delivery delay.

HTTP 429 retries use the same record and provider key, with bounded delay and at most five claims. HTTP 4xx failures stop, except 409 which is uncertain. Network failures, 5xx, malformed success responses, and crashed claimed workers become uncertain. No automatic retry or cross-provider fallback occurs for these cases. The watchdog retries a worker that failed before claiming the message, up to five recovery schedules. Monitor queued age and uncertain outcomes.

## Suppression and consent

`plunk.setRestriction(ctx, { email, blocked, marketingUnsubscribed })` imports local restrictions. A block suppresses queued transactional delivery. A marketing-only opt-out does not block an essential transactional message. This API does not change provider contacts.

Keep historical hard bounces and complaints blocked. Ordinary sends omit Plunk's `subscribed` property and never opt a contact into marketing. A subscribe webhook is recorded but cannot clear a local denial. Only an authorized host operation with evidence may clear a block.

Campaign selection, marketing consent, provider synchronization, and unsubscribe links remain host responsibilities.

## Workflow webhooks

Route an HTTP action to `plunk.handleWebhook(ctx, request)`. Set `PLUNK_WEBHOOK_SECRET`, then configure the same `Authorization: Bearer ...` header on each Plunk workflow webhook step.

The handler accepts a normalized envelope with `type`, `contact.email`, and `event`. Configure a separate workflow for each supported trigger and add its literal `type` to the custom body. Plunk's default body does not include an event type.

```json
{
  "type": "email.bounce",
  "contact": { "email": "{{email}}" },
  "event": {
    "emailId": "{{event.emailId}}",
    "bounceType": "{{event.bounceType}}"
  }
}
```

Supported types are `email.delivery`, `email.bounce`, `email.complaint`, `contact.unsubscribed`, and `contact.subscribed`. Include `event.emailId` for message correlation. Contact events can use `{}` for `event`. Soft bounces are acknowledged without a permanent block. Hard bounces and complaints block the address. An unsubscribe caused by a bounce or complaint must include the matching email event workflow as well.

The receiver uses body hashes for replay deduplication. It stores selected fields, not full message content. Plunk does not automatically retry failed workflow webhooks. Arrange periodic provider reconciliation before production use. The component does not supply that polling job.

## Retention

`components.plunk.lib.cleanup({ before })` deletes bounded batches of completed outbox records. It retains uncertain records and requires a cutoff at least 24 hours old. Keep records longer than your application's replay horizon: deleting a business key permits that key to enqueue again. Restrictions are never deleted by email cleanup. Event cleanup and automatic scheduling are not included yet.

## Tests

```ts
import { register } from "@clipin/convex-plunk/test";
register(t); // t is a convex-test instance
```

The test helper registers the component under `plunk`, or an explicit custom name. See the repository tests for host worker execution and fault cases.
