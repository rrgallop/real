# Tracker local development

`wrangler.jsonc` remains the production-shaped configuration. Use only
`wrangler.dev.jsonc` for local tracker work: it has no remote resource IDs,
routes, custom domains, preview URL, or `workers.dev` address. Its D1 binding
is explicitly local and persists only in the directory passed to
`--persist-to`.

The fixed token `local-dev-only-tracker-admin-token` is an intentionally public
local fixture, not a production credential. Use it only against a local server.

Run directly:

```sh
npm exec -- wrangler d1 migrations apply TRACKER_DB --config wrangler.dev.jsonc --local --persist-to /tmp/recrm-tracker-state
npm exec -- wrangler dev --config wrangler.dev.jsonc --local --persist-to /tmp/recrm-tracker-state --ip 127.0.0.1 --port 8788
```

Or build the local image, mount an empty named volume at `/state`, and publish
the container port to loopback only:

```sh
docker build -f Dockerfile.dev -t recrm-tracker-dev .
docker run --rm -p 127.0.0.1:8788:8788 -v recrm_tracker_dev_state:/state recrm-tracker-dev
```

The container applies migrations to local D1 before starting Wrangler. It does
not read `.env` or `.dev.vars`, and `wrangler dev --local` keeps the binding
local. Do not use this configuration for a deploy.

Production provisioning, verification, deployment, and rollback are documented
in [`docs/tracker-production-runbook.md`](docs/tracker-production-runbook.md).
