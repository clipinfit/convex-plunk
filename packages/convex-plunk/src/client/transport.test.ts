import { describe, expect, it, vi } from "vitest";
import { baseUrl, parseWebhook, send, validateMessage } from "./transport.js";

const message = {
  from: "hello@example.com",
  to: "reader@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
};
const config = {
  apiKey: "test-secret",
  baseUrl: "https://next-api.useplunk.com",
};
describe("Plunk transport", () => {
  it("maps HTML and preserves subscription state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        data: { emails: [{ email: "provider-id" }] },
      }),
    );
    expect(
      await send(
        {
          ...message,
          replyTo: "reply@example.com",
          headers: { "X-App": "test" },
        },
        "stable-key",
        config,
        fetcher,
      ),
    ).toEqual({ kind: "accepted", providerId: "provider-id" });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(`${config.baseUrl}/v1/send`);
    expect(request?.headers).toMatchObject({ "Idempotency-Key": "stable-key" });
    const payload = JSON.parse(String(request?.body));
    expect(payload.body).toBe(message.html);
    expect(payload.reply).toBe("reply@example.com");
    expect(payload).not.toHaveProperty("subscribed");
    expect(payload).not.toHaveProperty("text");
  });
  it.each([401, 402, 422])(
    "does not retry definitive HTTP %s",
    async (status) =>
      expect(
        await send(
          message,
          "key",
          config,
          async () => new Response(null, { status }),
        ),
      ).toMatchObject({ kind: "failed" }),
  );
  it.each([409, 500, 503])("records HTTP %s as uncertain", async (status) =>
    expect(
      await send(
        message,
        "key",
        config,
        async () => new Response(null, { status }),
      ),
    ).toMatchObject({ kind: "uncertain" }),
  );
  it("uses Retry-After on 429", async () =>
    expect(
      await send(
        message,
        "key",
        config,
        async () =>
          new Response(null, { status: 429, headers: { "Retry-After": "45" } }),
      ),
    ).toEqual({ kind: "retry", delayMs: 45000 }));
  it("does not blindly retry a timeout", async () =>
    expect(
      await send(message, "key", config, async () => {
        throw new Error("secret upstream detail");
      }),
    ).toEqual({
      kind: "uncertain",
      error: "Network error or timeout; reconcile before resending",
    }));
  it("does not invent a provider ID for malformed success", async () =>
    expect(
      await send(message, "key", config, async () =>
        Response.json({ success: true, data: {} }),
      ),
    ).toMatchObject({ kind: "uncertain" }));
  it("rejects unsafe headers and malformed addresses", () => {
    expect(() =>
      validateMessage({ ...message, to: "x\r\nBcc: victim@example.com" }),
    ).toThrow();
    expect(() =>
      validateMessage({ ...message, headers: { Authorization: "secret" } }),
    ).toThrow();
    expect(() =>
      validateMessage({ ...message, subject: "bad\nsubject" }),
    ).toThrow();
  });
  it("requires HTTPS and rejects credentials in the URL", () => {
    expect(() => baseUrl("http://example.com")).toThrow();
    expect(() => baseUrl("https://user:password@example.com")).toThrow();
  });
  it("ignores soft bounces and accepts permanent bounces", () => {
    expect(
      parseWebhook({
        type: "email.bounce",
        contact: { email: message.to },
        event: { bounceType: "Transient" },
      }),
    ).toBeNull();
    expect(
      parseWebhook({
        type: "email.bounce",
        contact: { email: message.to },
        event: { bounceType: "Permanent", emailId: "123" },
      }),
    ).toMatchObject({ providerId: "123" });
  });
});

it.each(["", "not-an-email", "reader@example.com\n"])(
  "rejects malformed webhook recipient %j",
  (email) => {
    expect(() =>
      parseWebhook({
        type: "contact.unsubscribed",
        contact: { email },
        event: {},
      }),
    ).toThrow();
  },
);
it.each([undefined, "", "Unknown"])(
  "rejects unclassified bounce type %j instead of acknowledging it",
  (bounceType) => {
    expect(() =>
      parseWebhook({
        type: "email.bounce",
        contact: { email: message.to },
        event: { bounceType },
      }),
    ).toThrow();
  },
);
it("requires a usable delivery correlation ID", () => {
  expect(() =>
    parseWebhook({
      type: "email.delivery",
      contact: { email: message.to },
      event: {},
    }),
  ).toThrow();
});
it("enforces the HTML limit in UTF-8 bytes", () => {
  expect(() =>
    validateMessage({ ...message, html: "😀".repeat(125001) }),
  ).toThrow("500 KB");
});
it("rejects invalid email header names", () => {
  expect(() =>
    validateMessage({ ...message, headers: { "X-App: injected": "value" } }),
  ).toThrow();
});
it("does not follow redirects when sending credentials and message content", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 302 }));
  await send(message, "key", config, fetcher);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
});
it.each(["", "garbage", "Wed, 01 Jan 2020 00:00:00 GMT"])(
  "bounds invalid or expired Retry-After %j",
  async (value) => {
    const result = await send(
      message,
      "key",
      config,
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": value } }),
    );
    expect(result.kind).toBe("retry");
    if (result.kind === "retry")
      expect(result.delayMs).toBeGreaterThanOrEqual(1000);
  },
);
