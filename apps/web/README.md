# Convex Plunk website

Marketing homepage and searchable documentation built with Next.js, Fumadocs, and Tailwind CSS.

## Run locally

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3016>. No Convex deployment or provider credentials are required.

Run `bun run build` from the root to build the component and website. Run `bun run --cwd apps/web start` to serve the website build.

## Edit content

- `app/page.tsx`: homepage.
- `content/docs`: documentation pages in MDX.
- `content/docs/meta.json`: navigation order.
- `lib/examples.ts`: homepage code examples.
- `app/docs/[[...slug]]/page.tsx`: document renderer.
- `app/api/search/route.ts`: content search endpoint.

Keep examples consistent with the component API. Search indexes the documentation source and requires no external search service.

## Deploy

Use `apps/web` as the project root and enable access to workspace files outside that directory. Install dependencies with Bun 1.4.0 and the frozen lockfile. Build with `bun run build` from the app directory.

Set the canonical site URL and social sharing metadata for the deployment domain. Do not add Plunk credentials to this app.
