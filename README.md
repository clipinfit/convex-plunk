# Convex Plunk

Durable transactional email delivery for Convex and hosted Plunk.

- Store email jobs and delivery states in Convex.
- Schedule messages and cancel queued jobs.
- Prevent duplicate queue entries with stable business keys.
- Control dispatch spacing and retry rate-limited requests.
- Block recipients and process authenticated workflow webhooks.
- Render templates with React Email and keep your existing preview workflow.

Test mode is enabled by default and makes no provider requests. Live sends require a Plunk API key and a verified sending domain.

See the [package guide](packages/convex-plunk/README.md) for setup and API usage. The [documentation source](apps/web/content/docs) covers scheduling, delivery states, restrictions, and webhooks.

## Scope

The component sends one transactional email per job. Marketing campaigns, segments, contact synchronization, attachments, and provider templates are outside its scope. Plunk generates the plain-text alternative from the supplied HTML.

An accepted API request does not prove delivery. Network failures and ambiguous responses produce an `uncertain` record for inspection. The component does not automatically resend these messages.

## Development

Use Node.js 22 or later and Bun 1.4.0.

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run test
bun run lint
bun run pack:check
```

These checks need no provider credentials. The package check installs a temporary tarball in a fresh consumer and verifies its exports, types, and test helper.

To run the example backend, keep this command active:

```sh
CONVEX_AGENT_MODE=anonymous bunx convex dev
```

The example defaults to offline mode. Queue a message from another terminal:

```sh
bunx convex run emails:enqueue '{"key":"example:001","to":"reader@example.com"}'
```

Use the returned ID with `emails:status`. A completed offline job has `state: "test"`.

To regenerate component types:

```sh
bun run --cwd packages/convex-plunk codegen
bun run build
```

## Website

Run `bun run dev` and open <http://localhost:3016>. The homepage is at `/` and documentation is at `/docs`. The website needs no provider credentials or running Convex backend.

## Repository structure

- `packages/convex-plunk`: component, host client, and tests.
- `packages/example-backend`: example Convex application.
- `apps/web`: website and searchable documentation.
- `scripts/check-package.mjs`: package installation check.

See [Contributing](CONTRIBUTING.md) and [Releasing](RELEASING.md) for maintenance instructions.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This is an independent component. It is not an official Convex or Plunk integration.
