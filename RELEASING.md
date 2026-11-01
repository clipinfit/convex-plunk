# Releasing

## Verify the package

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run lint
bun run build
bun run typecheck
bun run test
bun run pack:check
bun audit
```

Review the package contents and changelog. Confirm that CI passes for the commit you intend to publish. Keep credentials, recipient data, and local build output out of the package.

## Publish to npm

1. Update the package version and changelog. Update the lockfile with `bun install`.
2. Commit the release changes and wait for CI to pass.
3. Run `npm whoami` with an account that can publish under `@clipin`.
4. In `packages/convex-plunk`, run `npm pack --dry-run` and inspect the file list.
5. Run `npm publish --access public` and complete npm authentication.
6. Install the published version in a fresh Convex application. Verify the client, component configuration, generated types, and test helper.
7. Tag the published source commit as `v<VERSION>` and create the GitHub release with its changelog entry.

## Deploy the website

Use `apps/web` as the project root. Enable access to workspace files outside that directory. Install with `bun install --frozen-lockfile` and build with `bun run build`.

The website requires no Plunk credentials. Verify navigation, search, and installation examples after deployment.
