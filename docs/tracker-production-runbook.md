# Tracker Worker production runbook

This Worker serves the public Ryan R. Gallop / Real website and the opaque
reCRM link, property-wrapper, and campaign-unsubscribe routes. A deployment is
therefore both a public-site release and a tracker release.

## Fixed production resources

- Worker: `ryan-gallop-real-estate`
- Canonical origin: `https://homes.ryangallop.com`
- D1 binding: `TRACKER_DB`
- D1 database: `ryan-gallop-link-tracker`
- D1 database ID: `ebe37ec8-e963-4c6e-8b36-894b2c92e81d`
- Worker secret: `LINK_TRACKER_ADMIN_TOKEN`

The bearer value is never committed. It must match the value stored in the
production reCRM environment. reCRM also has a separate
`CAMPAIGN_UNSUBSCRIBE_HMAC_SECRET`; do not reuse the Worker bearer for it.

## Preflight

1. Confirm `git status --short` is empty and record the exact commit.
2. Run `npm ci` and `npm run check`.
3. Run `npm exec -- wrangler whoami` and confirm the intended account.
4. Record the active deployment with:

   ```sh
   npm exec -- wrangler deployments status --name ryan-gallop-real-estate
   npm exec -- wrangler versions list --name ryan-gallop-real-estate
   ```

5. Verify the canonical homepage and redirect aliases before deployment.
6. Keep reCRM `LINK_TRACKER_ENABLED=false` and `campaigns_enabled=false`
   throughout provisioning.

## Database and secret provisioning

The database is explicitly pinned in `wrangler.jsonc`; do not rely on automatic
resource provisioning.

Remote D1 migration statement mapping has historically treated quote marks in
SQL line comments inconsistently. Keep migration comments free of apostrophes
and validate every migration against a remote disposable or newly provisioned
database before relying on local Miniflare evidence alone.

```sh
npm exec -- wrangler d1 info ryan-gallop-link-tracker
npm exec -- wrangler d1 migrations list ryan-gallop-link-tracker --remote
npm exec -- wrangler d1 migrations apply ryan-gallop-link-tracker --remote
npm exec -- wrangler secret list
npm exec -- wrangler secret put LINK_TRACKER_ADMIN_TOKEN
```

Provide the secret interactively or from a mode-0600 file. Never place the
secret in a command argument, shell history, source file, log, or committed env
file.

After migrations, verify only schema/count metadata—never capability tokens:

```sh
npm exec -- wrangler d1 execute ryan-gallop-link-tracker --remote --command \
  "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
npm exec -- wrangler d1 execute ryan-gallop-link-tracker --remote --command \
  "SELECT (SELECT count(*) FROM tracked_links) AS links, (SELECT count(*) FROM campaign_unsubscribe_events) AS unsubscribes;"
```

## Deployment

Run a final bundle-only check, then deploy the committed tree:

```sh
npm exec -- wrangler deploy --dry-run --outdir .wrangler/dry-run
npm exec -- wrangler deploy --message "reCRM production tracker release"
```

Record the new version ID and deployment status. `wrangler deploy` publishes a
new version directly to production; D1 state is not versioned with Worker code.

## Production acceptance

Verify these behaviors without creating real contact or recipient records:

1. The canonical homepage, privacy page, static assets, and neutral redirect
   aliases render as before.
2. A valid-shape unknown `/l/<token>`, `/w/<token>`, and `/u/<token>` returns
   the expected non-enumerating not-found response with private/no-index
   headers.
3. An unauthenticated admin request returns `401` with private/no-index headers.
4. A bearer-authenticated drain against an empty database returns an empty
   event array. Do not print the bearer.
5. D1 tables and migration records are present and counts remain zero before
   reCRM registration.

Only after those checks may reCRM set `LINK_TRACKER_ENABLED=true`. Keep
`campaigns_enabled=false`, run a reconciliation cycle, and verify the queue is
clean before separately enabling campaigns.

## Rollback

Record the pre-release Worker version before every deployment. To restore its
code and bindings:

```sh
npm exec -- wrangler rollback <VERSION_ID> --message "Rollback after failed tracker acceptance"
```

Cloudflare Worker rollback does not roll back D1. The initial migrations are
additive and the previous static Worker does not use the new tables, so the
safe application rollback is to leave those empty tables in place. For future
schema changes, export or otherwise back up D1 before migration and document a
forward-compatible recovery; never delete or rewrite tracker evidence as part
of an ordinary code rollback.

If acceptance fails, immediately keep or return reCRM to
`LINK_TRACKER_ENABLED=false` and `campaigns_enabled=false` before rolling back
the Worker.
