import {
  createFunctionHandle,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  internalActionGeneric,
} from "convex/server";
import { type Infer, v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";

import {
  baseUrl,
  type Message,
  parseWebhook,
  send,
  validateMessage,
} from "./transport.js";

export type { Message, Outcome } from "./transport.js";
export type PlunkOptions = {
  testMode?: boolean;
  apiKey?: string;
  apiBaseUrl?: string;
  webhookSecret?: string;
  intervalMs?: number;
};
type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
export const workerArgs = { id: v.string() };
export class Plunk {
  private readonly options: Required<
    Pick<PlunkOptions, "testMode" | "intervalMs" | "apiBaseUrl">
  > &
    PlunkOptions;
  constructor(
    public readonly component: ComponentApi,
    options: PlunkOptions = {},
  ) {
    this.options = {
      ...options,
      testMode: options.testMode ?? true,
      intervalMs: options.intervalMs ?? 1000,
      apiBaseUrl: baseUrl(
        options.apiBaseUrl ?? "https://next-api.useplunk.com",
      ),
    };
  }
  async sendEmail(
    ctx: MutationCtx,
    args: Message & {
      idempotencyKey: string;
      worker: FunctionReference<
        "action",
        "internal",
        Infer<typeof workerValidator>
      >;
      scheduledAt?: number;
    },
  ) {
    validateMessage(args);
    if (
      args.scheduledAt !== undefined &&
      (!Number.isFinite(args.scheduledAt) || args.scheduledAt <= Date.now())
    )
      throw new Error("scheduledAt must be a future timestamp");
    const { idempotencyKey, worker, scheduledAt, ...message } = args;
    return ctx.runMutation(this.component.lib.enqueue, {
      key: idempotencyKey,
      message,
      worker: await createFunctionHandle(worker),
      testMode: this.options.testMode,
      scheduledAt: scheduledAt ?? Date.now(),
      intervalMs: this.options.intervalMs,
    });
  }
  getStatus(ctx: QueryCtx, id: string) {
    return ctx.runQuery(this.component.lib.get, { id });
  }
  cancel(ctx: MutationCtx, id: string) {
    return ctx.runMutation(this.component.lib.cancel, { id });
  }
  /** Trusted server API: explicitly clearing blocks requires host authorization and evidence. */
  setRestriction(
    ctx: MutationCtx,
    args: { email: string; blocked: boolean; marketingUnsubscribed: boolean },
  ) {
    return ctx.runMutation(this.component.lib.restrict, args);
  }
  /** Define and export this internal action in the host application. Credentials stay in that runtime. */
  worker() {
    return internalActionGeneric({
      args: workerArgs,
      handler: async (ctx, { id }) => {
        const row = await ctx.runMutation(this.component.lib.claim, { id });
        if (!row) return;
        if (row.testMode) {
          await ctx.runMutation(this.component.lib.finish, {
            id,
            token: row.token,
            outcome: { kind: "test" },
          });
          return;
        }
        const apiKey = this.options.apiKey ?? process.env.PLUNK_API_KEY;
        const outcome = apiKey
          ? await send(row.message, `convex-plunk:${id}`, {
              apiKey,
              baseUrl: this.options.apiBaseUrl,
            })
          : { kind: "failed" as const, error: "PLUNK_API_KEY is missing" };
        await ctx.runMutation(this.component.lib.finish, {
          id,
          token: row.token,
          outcome,
        });
      },
    });
  }
  async handleWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
    const secret =
      this.options.webhookSecret ?? process.env.PLUNK_WEBHOOK_SECRET;
    if (!secret) return new Response("Webhook is disabled", { status: 503 });
    const expected = new TextEncoder().encode(`Bearer ${secret}`);
    const actual = new TextEncoder().encode(
      request.headers.get("authorization") ?? "",
    );
    let difference = expected.length ^ actual.length;
    for (let i = 0; i < expected.length; i++)
      difference |= expected[i] ^ (actual[i] ?? 0);
    if (difference !== 0) return new Response("Unauthorized", { status: 401 });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    // Limit bytes while reading, rather than allocating an unbounded request body.
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid event", { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    let raw: string;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 65536) {
          await reader.cancel();
          return new Response("Payload too large", { status: 413 });
        }
        chunks.push(value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return new Response("Invalid event", { status: 400 });
    } finally {
      reader.releaseLock();
    }
    let event: ReturnType<typeof parseWebhook>;
    try {
      event = parseWebhook(JSON.parse(raw));
    } catch {
      return new Response("Invalid event", { status: 400 });
    }
    if (event) {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(raw),
      );
      const key = Array.from(new Uint8Array(bytes), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      await ctx.runMutation(this.component.lib.event, { ...event, key });
    }
    return new Response(null, { status: 204 });
  }
}
const workerValidator = v.object({ id: v.string() });
