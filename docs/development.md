# Development

Gongyu requires [Bun](https://bun.sh/) 1.3.9 and a browser with WebAuthn support.

## Local setup

Install the dependencies, create the local D1 database, and start the development server:

```bash
bun install --frozen-lockfile
bunx wrangler d1 migrations apply DB --local --config apps/web/wrangler.jsonc
bun run dev
```

Open <http://localhost:5173/setup> and enter the bootstrap token from `apps/web/wrangler.jsonc`. Wrangler keeps local D1 and R2 data under `.wrangler/`.

## Checks

```bash
bun run lint
bun run typecheck
bun run test
bun run check
bun run --cwd apps/web test:e2e
```

`bun run check` typechecks both applications, builds the production Worker, and runs a Wrangler deployment dry run. Run `bun run format` to format the repository.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web` | React application and Cloudflare Worker entrypoint |
| `apps/jobs` | Queue, cron, and Workflow handlers |
| `packages/auth` | Passkey and session services |
| `packages/data` | D1 repositories and persistence adapters |
| `packages/domain` | Domain models and contracts |
| `packages/integrations` | R2, metadata, encryption, Shaarli, and social adapters |
| `packages/ui` | Shared UI components |
| `migrations` | D1 migrations |
