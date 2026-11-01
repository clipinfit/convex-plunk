export type Message = {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
};
export type Outcome =
  | { kind: "accepted"; providerId: string }
  | { kind: "test" }
  | { kind: "retry"; delayMs: number }
  | { kind: "failed"; error: string }
  | { kind: "uncertain"; error: string };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isEmail(value: string) {
  return value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}
export function validateMessage(message: Message) {
  for (const value of [message.from, message.to, message.replyTo].filter(
    (v) => v !== undefined,
  ))
    if (!isEmail(value))
      throw new Error("Use a plain email address for from, to and replyTo");
  if (
    !message.subject.trim() ||
    /[\r\n]/.test(message.subject) ||
    message.subject.length > 998
  )
    throw new Error("Invalid subject");
  if (
    !message.html.trim() ||
    new TextEncoder().encode(message.html).byteLength > 500000
  )
    throw new Error("Provide HTML within the 500 KB component limit");
  for (const [key, value] of Object.entries(message.headers ?? {}))
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
      /[\r\n]/.test(key + value) ||
      value.length > 998 ||
      ["authorization", "idempotency-key"].includes(key.toLowerCase())
    )
      throw new Error("Invalid or reserved email header");
}
export async function send(
  message: Message,
  key: string,
  config: { apiKey: string; baseUrl: string },
  fetcher: typeof fetch = fetch,
): Promise<Outcome> {
  try {
    const response = await fetcher(`${config.baseUrl}/v1/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        body: message.html,
        ...(message.replyTo ? { reply: message.replyTo } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds = raw ? Number(raw) : NaN;
      const delayMs = Number.isFinite(seconds)
        ? seconds * 1000
        : Math.max(1000, Date.parse(raw ?? "") - Date.now());
      return {
        kind: "retry",
        delayMs: Number.isFinite(delayMs) ? delayMs : 30000,
      };
    }
    if (response.status === 409 || response.status >= 500)
      return {
        kind: "uncertain",
        error: `Plunk HTTP ${response.status}; reconcile before resending`,
      };
    if (!response.ok)
      return { kind: "failed", error: `Plunk HTTP ${response.status}` };
    const body: unknown = await response.json();
    if (
      record(body) &&
      body.success === true &&
      record(body.data) &&
      Array.isArray(body.data.emails) &&
      body.data.emails.length === 1
    ) {
      const item: unknown = body.data.emails[0];
      if (record(item) && typeof item.email === "string" && item.email)
        return { kind: "accepted", providerId: item.email };
    }
    return { kind: "uncertain", error: "Unrecognized Plunk success response" };
  } catch {
    return {
      kind: "uncertain",
      error: "Network error or timeout; reconcile before resending",
    };
  }
}
export function baseUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS Plunk API base URL without credentials or query parameters",
    );
  return url.toString().replace(/\/$/, "");
}
export function parseWebhook(input: unknown) {
  if (
    !record(input) ||
    typeof input.type !== "string" ||
    !record(input.contact) ||
    typeof input.contact.email !== "string" ||
    !isEmail(input.contact.email) ||
    !record(input.event)
  )
    throw new Error("Invalid normalized webhook envelope");
  const supported = [
    "email.delivery",
    "email.bounce",
    "email.complaint",
    "contact.unsubscribed",
    "contact.subscribed",
  ];
  if (!supported.includes(input.type))
    throw new Error("Unsupported webhook event");
  if (
    input.type === "email.delivery" &&
    (typeof input.event.emailId !== "string" || !input.event.emailId.trim())
  )
    throw new Error("Delivery event requires emailId");
  if (
    input.event.emailId !== undefined &&
    (typeof input.event.emailId !== "string" || !input.event.emailId.trim())
  )
    throw new Error("Invalid emailId");
  if (input.type === "email.bounce") {
    if (input.event.bounceType === "Transient") return null;
    if (input.event.bounceType !== "Permanent")
      throw new Error("Unknown bounce type; reconcile recipient restrictions");
  }
  return {
    type: input.type,
    email: input.contact.email,
    ...(typeof input.event.emailId === "string"
      ? { providerId: input.event.emailId }
      : {}),
  };
}
