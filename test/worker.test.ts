import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/worker";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const ADMIN_TOKEN = "test-admin-secret";
const TOKEN_A = "AbCdEfGhIjKlMnOpQrStUv";
const TOKEN_B = "ZyXwVuTsRqPoNmLkJiHgFe";
const TOKEN_C = "0123456789_-AbCdEfGhIj";
const WRAPPER_HASH = "a".repeat(64);
const CLIENT_EVENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_EVENT_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_EVENT_C = "33333333-3333-4333-8333-333333333333";

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${index
    .toString(16)
    .padStart(12, "0")}`;
}

function request(
  url: string,
  init?: RequestInit<IncomingRequestCfProperties>,
): Request<unknown, IncomingRequestCfProperties> {
  return new IncomingRequest(url, init);
}

function adminHeaders(token = ADMIN_TOKEN): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function admin(
  pathname: string,
  body: unknown,
  token = ADMIN_TOKEN,
): Promise<Response> {
  return worker.fetch(
    request(`https://homes.ryangallop.com${pathname}`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function register(
  token: string,
  targetUrl = "https://www.zillow.com/homedetails/example/",
  expiresAt: string | null = null,
): Promise<Response> {
  return admin("/admin/links", {
    token,
    target_url: targetUrl,
    expires_at: expiresAt,
  });
}

function wrapperPayload(
  token = TOKEN_A,
  hero: unknown = { kind: "location_marker" },
): Record<string, unknown> {
  return {
    token,
    target_url: "https://www.zillow.com/homedetails/example/",
    expires_at: null,
    schema_version: 1,
    content_hash: WRAPPER_HASH,
    dwell_threshold_seconds: 10,
    content: {
      listing_address: "123 Coastline Avenue, Oceanside, CA 92054",
      property_intro:
        "A concise look at the home and a few details worth comparing.",
      ryan_note:
        "The layout and outdoor space are the two features I would weigh together.",
      fact_sections: [
        { label: "Living space", text: "1,850 square feet" },
        { label: "Year built", text: "1987" },
      ],
      hero,
    },
  };
}

async function registerWrapper(
  payload: Record<string, unknown> = wrapperPayload(),
): Promise<Response> {
  return admin("/admin/wrappers", payload);
}

async function wrapperEvent(
  body: unknown,
  token = TOKEN_A,
): Promise<Response> {
  return worker.fetch(
    request(`https://homes.ryangallop.com/w/${token}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.TRACKER_DB.batch([
    env.TRACKER_DB.prepare("DELETE FROM wrapper_event_rate_buckets"),
    env.TRACKER_DB.prepare("DELETE FROM link_events"),
    env.TRACKER_DB.prepare("DELETE FROM tracked_links"),
  ]);
});

describe("existing site behavior", () => {
  it("preserves alias redirects, paths, and query strings", async () => {
    const response = await worker.fetch(
      request(`https://ryangallop.com/l/${TOKEN_A}?source=email`),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `https://homes.ryangallop.com/l/${TOKEN_A}?source=email`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    await expect(response.text()).resolves.toBe("");
  });

  it("continues to serve static assets with the existing security headers", async () => {
    const response = await worker.fetch(
      request("https://homes.ryangallop.com/robots.txt"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).toContain("User-agent");
  });

  it("does not publish Worker source, migrations, tests, or build config", async () => {
    for (const pathname of [
      "/src/worker.ts",
      "/migrations/0002_wrapper_pages.sql",
      "/test/worker.test.ts",
      "/package.json",
      "/wrangler.jsonc",
      "/worker-configuration.d.ts",
    ]) {
      const response = await worker.fetch(
        request(`https://homes.ryangallop.com${pathname}`),
        env,
      );
      expect(response.status, pathname).toBe(404);
    }
  });
});

describe("admin authentication and registration", () => {
  it("requires the configured bearer token", async () => {
    const missing = await worker.fetch(
      request("https://homes.ryangallop.com/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      env,
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(await json(missing)).toEqual({ error: "unauthorized" });

    const wrong = await admin("/admin/events", {}, "wrong-secret");
    expect(wrong.status).toBe(401);
    expect(await json(wrong)).toEqual({ error: "unauthorized" });
  });

  it("registers and idempotently upserts an active token", async () => {
    const first = await register(TOKEN_A);
    expect(first.status).toBe(201);
    expect(await json(first)).toEqual({
      ok: true,
      created: true,
      status: "active",
      expires_at: null,
    });

    const expiry = "2027-01-15T12:30:00-08:00";
    const second = await register(
      TOKEN_A,
      "https://www.zillow.com/homedetails/updated/?utm_source=recrm",
      expiry,
    );
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({
      ok: true,
      created: false,
      status: "active",
      expires_at: "2027-01-15T20:30:00.000Z",
    });

    const resolved = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`, {
        method: "HEAD",
      }),
      env,
    );
    expect(resolved.status).toBe(302);
    expect(resolved.headers.get("location")).toBe(
      "https://www.zillow.com/homedetails/updated/?utm_source=recrm",
    );
    await expect(resolved.text()).resolves.toBe("");
  });

  it("rejects contact data instead of silently retaining it", async () => {
    const response = await admin("/admin/links", {
      token: TOKEN_A,
      target_url: "https://www.zillow.com/homedetails/example/",
      expires_at: null,
      contact_id: "local-contact-123",
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "invalid_link" });

    const linkColumns = await env.TRACKER_DB.prepare(
      "PRAGMA table_info(tracked_links)",
    ).all<{ name: string }>();
    const eventColumns = await env.TRACKER_DB.prepare(
      "PRAGMA table_info(link_events)",
    ).all<{ name: string }>();
    const wrapperColumns = await env.TRACKER_DB.prepare(
      "PRAGMA table_info(wrapper_pages)",
    ).all<{ name: string }>();
    const rateBucketColumns = await env.TRACKER_DB.prepare(
      "PRAGMA table_info(wrapper_event_rate_buckets)",
    ).all<{ name: string }>();
    expect(linkColumns.results.map((column) => column.name)).toEqual([
      "token",
      "target_url",
      "status",
      "expires_at",
      "created_at",
      "updated_at",
      "revoked_at",
      "link_kind",
    ]);
    expect(eventColumns.results.map((column) => column.name)).toEqual([
      "id",
      "token",
      "event_type",
      "occurred_at",
      "request_class",
      "engagement_kind",
      "dwell_ms",
      "client_event_id",
    ]);
    expect(wrapperColumns.results.map((column) => column.name)).toEqual([
      "token",
      "schema_version",
      "content_hash",
      "dwell_threshold_seconds",
      "listing_address",
      "property_intro",
      "ryan_note",
      "fact_sections_json",
      "hero_json",
      "created_at",
    ]);
    expect(rateBucketColumns.results.map((column) => column.name)).toEqual([
      "token",
      "utc_day",
      "event_kind",
      "event_count",
      "updated_at",
    ]);
  });

  it.each([
    ["http target", "http://www.zillow.com/homedetails/example/"],
    ["credentials", "https://user:pass@www.zillow.com/private"],
    ["localhost", "https://localhost/private"],
    ["private IPv4", "https://192.168.1.20/private"],
    [
      "tracked-link loop",
      `https://homes.ryangallop.com/l/${TOKEN_B}`,
    ],
    [
      "tracked-link loop with trailing-dot host",
      `https://homes.ryangallop.com./l/${TOKEN_B}`,
    ],
    [
      "wrapper loop",
      `https://homes.ryangallop.com/w/${TOKEN_B}`,
    ],
    [
      "raw space",
      "https://www.zillow.com/homedetails/has space/",
    ],
    [
      "raw line feed",
      "https://www.zillow.com/homedetails/example/\nnext",
    ],
    [
      "raw carriage return",
      "https://www.zillow.com/homedetails/example/\rnext",
    ],
    [
      "raw tab",
      "https://www.zillow.com/homedetails/example/\tnext",
    ],
  ])("rejects an unsafe %s", async (_caseName, targetUrl) => {
    const response = await register(TOKEN_A, targetUrl);
    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({
      error: expect.stringMatching(/target|tracked_link/),
    });
  });

  it.each([
    "contact",
    "contact_id",
    "email",
    "email_address",
    "lead_id",
    "mobile",
    "phone",
    "phone_number",
    "recipient",
  ])("rejects a destination with sensitive %s query data", async (key) => {
    const response = await register(
      TOKEN_A,
      `https://www.zillow.com/homedetails/example/?${key.toUpperCase()}=abc`,
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "invalid_target_url" });
  });

  it.each([
    [
      "opaque query value",
      "https://www.zillow.com/homedetails/example/?next=ryan%40example.com",
    ],
    [
      "encoded path",
      "https://www.zillow.com/homedetails/ryan%40example.com/",
    ],
  ])("rejects an email address in a decoded %s", async (_caseName, targetUrl) => {
    const response = await register(TOKEN_A, targetUrl);

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "invalid_target_url" });
  });

  it.each([
    [
      "unsubscribe path",
      "https://example.com/preferences/unsubscribe/abc",
    ],
    [
      "hyphenated opt-out path",
      "https://example.com/preferences/opt-out/abc",
    ],
    [
      "unsubscribe query",
      "https://example.com/preferences?unsubscribe=abc",
    ],
    [
      "hyphenated opt-out query",
      "https://example.com/preferences?opt-out=abc",
    ],
  ])("keeps %s outside the tracker", async (_caseName, targetUrl) => {
    const response = await register(TOKEN_A, targetUrl);

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "invalid_target_url" });
  });

  it("never reactivates a revoked token", async () => {
    await json(await register(TOKEN_A));
    const revoked = await admin("/admin/links/revoke", { token: TOKEN_A });
    expect(revoked.status).toBe(200);
    expect(await json(revoked)).toEqual({
      ok: true,
      revoked: true,
      status: "revoked",
    });

    const repeatedRevoke = await admin("/admin/links/revoke", {
      token: TOKEN_A,
    });
    expect(repeatedRevoke.status).toBe(200);
    expect(await json(repeatedRevoke)).toEqual({
      ok: true,
      revoked: false,
      status: "revoked",
    });

    const reregister = await register(
      TOKEN_A,
      "https://www.zillow.com/homedetails/different/",
    );
    expect(reregister.status).toBe(409);
    expect(await json(reregister)).toEqual({ error: "link_revoked" });
  });
});

describe("wrapper registration and rendering", () => {
  it("atomically registers an immutable wrapper and idempotently replays it", async () => {
    const batch = vi.spyOn(env.TRACKER_DB, "batch");
    const first = await registerWrapper();

    expect(first.status).toBe(201);
    expect(await json(first)).toEqual({
      ok: true,
      created: true,
      status: "active",
      expires_at: null,
      content_hash: WRAPPER_HASH,
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);

    const retry = await registerWrapper();
    expect(retry.status).toBe(200);
    expect(await json(retry)).toEqual({
      ok: true,
      created: false,
      status: "active",
      expires_at: null,
      content_hash: WRAPPER_HASH,
    });

    const link = await env.TRACKER_DB.prepare(
      "SELECT link_kind, target_url FROM tracked_links WHERE token = ?1",
    )
      .bind(TOKEN_A)
      .first<{ link_kind: string; target_url: string }>();
    expect(link).toEqual({
      link_kind: "wrapper",
      target_url: "https://www.zillow.com/homedetails/example/",
    });
  });

  it("accepts a valid wrapper above 16 KiB and rejects bodies above 64 KiB", async () => {
    const largePayload = wrapperPayload();
    largePayload.content = {
      listing_address: "界".repeat(250),
      property_intro: "界".repeat(2000),
      ryan_note: "界".repeat(2000),
      fact_sections: Array.from({ length: 4 }, () => ({
        label: "界".repeat(80),
        text: "界".repeat(1000),
      })),
      hero: { kind: "location_marker" },
    };
    const validBytes = new TextEncoder().encode(
      JSON.stringify(largePayload),
    ).byteLength;
    expect(validBytes).toBeGreaterThan(16 * 1024);
    expect(validBytes).toBeLessThanOrEqual(64 * 1024);

    const accepted = await registerWrapper(largePayload);
    expect(accepted.status).toBe(201);

    const oversizedBody = JSON.stringify({
      padding: "x".repeat(64 * 1024),
    });
    expect(new TextEncoder().encode(oversizedBody).byteLength).toBeGreaterThan(
      64 * 1024,
    );
    const rejected = await worker.fetch(
      request("https://homes.ryangallop.com/admin/wrappers", {
        method: "POST",
        headers: adminHeaders(),
        body: oversizedBody,
      }),
      env,
    );
    expect(rejected.status).toBe(413);
    expect(await json(rejected)).toEqual({ error: "request_too_large" });

    const ordinaryAdminRoute = await admin("/admin/links", {
      padding: "x".repeat(16 * 1024),
    });
    expect(ordinaryAdminRoute.status).toBe(413);
    expect(await json(ordinaryAdminRoute)).toEqual({
      error: "request_too_large",
    });
  });

  it("returns wrapper_conflict for any immutable mismatch or cross-kind reuse", async () => {
    await registerWrapper();
    const changed = wrapperPayload();
    changed.content_hash = "b".repeat(64);
    const mismatch = await registerWrapper(changed);
    expect(mismatch.status).toBe(409);
    expect(await json(mismatch)).toEqual({ error: "wrapper_conflict" });

    const redirectAttempt = await register(
      TOKEN_A,
      "https://www.zillow.com/homedetails/other/",
    );
    expect(redirectAttempt.status).toBe(409);
    expect(await json(redirectAttempt)).toEqual({
      error: "link_registration_conflict",
    });

    await register(TOKEN_B);
    const wrapperOnRedirect = await registerWrapper(wrapperPayload(TOKEN_B));
    expect(wrapperOnRedirect.status).toBe(409);
    expect(await json(wrapperOnRedirect)).toEqual({
      error: "wrapper_conflict",
    });
  });

  it("normalizes an explicit expiry and keeps an identical revoked retry immutable", async () => {
    const payload = wrapperPayload();
    payload.expires_at = "2027-01-15T12:30:00-08:00";
    const created = await registerWrapper(payload);
    expect(await json(created)).toMatchObject({
      expires_at: "2027-01-15T20:30:00.000Z",
    });

    await admin("/admin/links/revoke", { token: TOKEN_A });
    const retry = await registerWrapper(payload);
    expect(retry.status).toBe(200);
    expect(await json(retry)).toEqual({
      ok: true,
      created: false,
      status: "revoked",
      expires_at: "2027-01-15T20:30:00.000Z",
      content_hash: WRAPPER_HASH,
    });
  });

  it.each([
    [
      "an eighth top-level field",
      () => ({ ...wrapperPayload(), contact_id: "contact-123" }),
    ],
    [
      "a non-Zillow destination",
      () => ({
        ...wrapperPayload(),
        target_url: "https://example.org/listing/123",
      }),
    ],
    [
      "contact information in copy",
      () => {
        const payload = wrapperPayload();
        payload.content = {
          ...(payload.content as Record<string, unknown>),
          ryan_note: "Call 760-555-1234 when you are ready.",
        };
        return payload;
      },
    ],
    [
      "Markdown in copy",
      () => {
        const payload = wrapperPayload();
        payload.content = {
          ...(payload.content as Record<string, unknown>),
          property_intro: "See [the photos](https://example.org/photo).",
        };
        return payload;
      },
    ],
    [
      "an obsolete location label",
      () => wrapperPayload(TOKEN_A, {
        kind: "location_marker",
        label: "Oceanside",
      }),
    ],
    [
      "an obsolete chart display value",
      () => wrapperPayload(TOKEN_A, {
        kind: "comparison_chart",
        title: "Nearby context",
        bars: [
          { label: "This home", value: 10, display_value: "10" },
          { label: "Nearby", value: 8 },
        ],
      }),
    ],
  ])("rejects %s", async (_caseName, buildPayload) => {
    const response = await registerWrapper(buildPayload());
    expect(response.status).toBe(400);
  });

  it("accepts the strict comparison-chart union", async () => {
    const response = await registerWrapper(
      wrapperPayload(TOKEN_A, {
        kind: "comparison_chart",
        title: "A simple side-by-side",
        bars: [
          { label: "Subject", value: 1850 },
          { label: "Nearby median", value: 1710 },
        ],
      }),
    );

    expect(response.status).toBe(201);
    const page = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`),
      env,
    );
    const html = await page.text();
    expect(html).toContain("A simple side-by-side");
    expect(html).toContain("<meter");
    expect(html).toContain("1,850");
  });

  it("renders a private neutral co-brand page with no inline or third-party assets", async () => {
    await registerWrapper();
    const response = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "font-src 'self'",
    );
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin",
    );

    const html = await response.text();
    expect(html).toContain('href="/assets/wrapper.css"');
    expect(html).toContain('src="/assets/wrapper.js"');
    expect(html).toContain('src="/assets/logo-mark.svg"');
    expect(html).toContain('src="/assets/real-logo-outline-white.svg"');
    expect(html).toContain("View full listing on Zillow →");
    expect(html).toContain(
      "Ryan R. Gallop · DRE #02403134 · Real Brokerage Technologies · California DRE #02022092",
    );
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toContain("Reinventing Realty");
    expect(html).not.toContain("Big decisions deserve data-backed confidence");
    expect(html).not.toContain("contact_id");
  });

  it("serves the wrapper assets from the same origin", async () => {
    const css = await worker.fetch(
      request("https://homes.ryangallop.com/assets/wrapper.css"),
      env,
    );
    const script = await worker.fetch(
      request("https://homes.ryangallop.com/assets/wrapper.js"),
      env,
    );
    const cormorant400 = await worker.fetch(
      request(
        "https://homes.ryangallop.com/assets/fonts/cormorant-garamond-latin-400.woff2",
      ),
      env,
    );
    const cormorant500 = await worker.fetch(
      request(
        "https://homes.ryangallop.com/assets/fonts/cormorant-garamond-latin-500.woff2",
      ),
      env,
    );
    const inter = await worker.fetch(
      request(
        "https://homes.ryangallop.com/assets/fonts/inter-latin-variable.woff2",
      ),
      env,
    );
    const montserrat = await worker.fetch(
      request(
        "https://homes.ryangallop.com/assets/fonts/montserrat-latin-variable.woff2",
      ),
      env,
    );

    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain(".wrapper-identity");
    expect(cormorant400.status).toBe(200);
    expect(cormorant400.headers.get("content-type")).toContain("font/woff2");
    expect(cormorant500.status).toBe(200);
    expect(cormorant500.headers.get("content-type")).toContain("font/woff2");
    expect(inter.status).toBe(200);
    expect(inter.headers.get("content-type")).toContain("font/woff2");
    expect(montserrat.status).toBe(200);
    expect(montserrat.headers.get("content-type")).toContain("font/woff2");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    const source = await script.text();
    expect(source).toContain("document.visibilityState");
    expect(source).toContain("navigator.sendBeacon");
    expect(source).toContain("keepalive: true");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("document.cookie");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("preventDefault");
  });

  it("uses 404/410 semantics and keeps HEAD free of telemetry", async () => {
    const unknown = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`),
      env,
    );
    expect(unknown.status).toBe(404);
    expect(await json(unknown)).toEqual({ error: "wrapper_not_found" });

    await registerWrapper();
    const head = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`, {
        method: "HEAD",
      }),
      env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(
      await json<{ events: EdgeEvent[] }>(
        await admin("/admin/events", { limit: 10 }),
      ),
    ).toEqual({ events: [] });

    await admin("/admin/links/revoke", { token: TOKEN_A });
    const revoked = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`),
      env,
    );
    expect(revoked.status).toBe(410);
    expect(await json(revoked)).toEqual({ error: "wrapper_unavailable" });
  });

  it("canonicalizes wrapper paths from neutral aliases with private headers", async () => {
    const response = await worker.fetch(
      request(`https://rgallop.com/w/${TOKEN_A}?source=email`),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `https://homes.ryangallop.com/w/${TOKEN_A}?source=email`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("enforces database-level kind and wrapper-content immutability", async () => {
    await registerWrapper();

    await expect(
      env.TRACKER_DB.prepare(
        "UPDATE tracked_links SET link_kind = 'redirect' WHERE token = ?1",
      )
        .bind(TOKEN_A)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TRACKER_DB.prepare(
        "UPDATE wrapper_pages SET ryan_note = 'Changed' WHERE token = ?1",
      )
        .bind(TOKEN_A)
        .run(),
    ).rejects.toThrow();
  });
});

describe("wrapper telemetry", () => {
  it("records viewed, dwell, and CTA evidence with client UUID idempotency", async () => {
    await registerWrapper();

    const viewed = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_A,
    });
    expect(viewed.status).toBe(202);
    expect(await json(viewed)).toEqual({ ok: true, recorded: true });

    const replay = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_A,
    });
    expect(replay.status).toBe(202);
    expect(await json(replay)).toEqual({ ok: true, recorded: false });

    const dwell = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_B,
      engagement_kind: "dwell",
      dwell_ms: 10_250,
    });
    expect(dwell.status).toBe(202);

    const cta = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_C,
      engagement_kind: "cta",
    });
    expect(cta.status).toBe(202);

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 10 }),
    );
    expect(drained.events).toHaveLength(3);
    expect(drained.events[0]).toMatchObject({
      token: TOKEN_A,
      event_type: "wrapper_viewed",
      request_class: "unclassified",
      client_event_id: CLIENT_EVENT_A,
      engagement_kind: null,
      dwell_ms: null,
    });
    expect(drained.events[1]).toMatchObject({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_B,
      engagement_kind: "dwell",
      dwell_ms: 10_250,
    });
    expect(drained.events[2]).toMatchObject({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_C,
      engagement_kind: "cta",
      dwell_ms: null,
    });
    for (const event of drained.events) {
      expect(event).not.toHaveProperty("ip");
      expect(event).not.toHaveProperty("user_agent");
      expect(event).not.toHaveProperty("cookie");
    }
  });

  it("enforces independent UTC-day view, dwell, and CTA caps", async () => {
    await registerWrapper();

    for (let index = 0; index < 12; index += 1) {
      const response = await wrapperEvent({
        event_type: "wrapper_viewed",
        client_event_id: testUuid(index),
      });
      expect(response.status).toBe(202);
      await response.text();
    }

    const replay = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: testUuid(0),
    });
    expect(replay.status).toBe(202);
    expect(await json(replay)).toEqual({ ok: true, recorded: false });

    const conflict = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: testUuid(0),
      engagement_kind: "cta",
    });
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toEqual({
      error: "client_event_conflict",
    });

    const excessView = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: testUuid(12),
    });
    expect(excessView.status).toBe(429);
    expect(await json(excessView)).toEqual({
      error: "wrapper_event_rate_limited",
    });
    expect(Number(excessView.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(excessView.headers.get("retry-after"))).toBeLessThanOrEqual(
      86_400,
    );

    await registerWrapper(wrapperPayload(TOKEN_B));
    const otherTokenView = await wrapperEvent(
      {
        event_type: "wrapper_viewed",
        client_event_id: testUuid(50),
      },
      TOKEN_B,
    );
    expect(otherTokenView.status).toBe(202);
    await otherTokenView.text();

    for (let index = 100; index < 112; index += 1) {
      const response = await wrapperEvent({
        event_type: "wrapper_engaged",
        client_event_id: testUuid(index),
        engagement_kind: "dwell",
        dwell_ms: 10_000,
      });
      expect(response.status).toBe(202);
      await response.text();
    }
    const excessDwell = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: testUuid(112),
      engagement_kind: "dwell",
      dwell_ms: 10_000,
    });
    expect(excessDwell.status).toBe(429);
    expect(await json(excessDwell)).toEqual({
      error: "wrapper_event_rate_limited",
    });

    for (let index = 200; index < 206; index += 1) {
      const response = await wrapperEvent({
        event_type: "wrapper_engaged",
        client_event_id: testUuid(index),
        engagement_kind: "cta",
      });
      expect(response.status).toBe(202);
      await response.text();
    }
    const excessCta = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: testUuid(206),
      engagement_kind: "cta",
    });
    expect(excessCta.status).toBe(429);
    expect(await json(excessCta)).toEqual({
      error: "wrapper_event_rate_limited",
    });

    const buckets = await env.TRACKER_DB.prepare(
      `SELECT event_kind, event_count
         FROM wrapper_event_rate_buckets
        WHERE token = ?1
        ORDER BY event_kind`,
    )
      .bind(TOKEN_A)
      .all<{ event_kind: string; event_count: number }>();
    expect(buckets.results).toEqual([
      { event_kind: "cta", event_count: 6 },
      { event_kind: "dwell", event_count: 12 },
      { event_kind: "view", event_count: 12 },
    ]);

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 500 }),
    );
    expect(drained.events).toHaveLength(31);
    const ack = await admin("/admin/events/ack", {
      ids: drained.events.map((event) => event.id),
    });
    expect(await json(ack)).toEqual({ acked: 31 });

    const persistedBucket = await env.TRACKER_DB.prepare(
      `SELECT event_count
         FROM wrapper_event_rate_buckets
        WHERE token = ?1
          AND event_kind = 'view'`,
    )
      .bind(TOKEN_A)
      .first<{ event_count: number }>();
    expect(persistedBucket).toEqual({ event_count: 12 });

    const stillLimited = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: testUuid(13),
    });
    expect(stillLimited.status).toBe(429);
    await stillLimited.text();

    const page = await worker.fetch(
      request(`https://homes.ryangallop.com/w/${TOKEN_A}`),
      env,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(
      'href="https://www.zillow.com/homedetails/example/"',
    );
  });

  it("starts a fresh UTC-day bucket and prunes buckets older than 14 days", async () => {
    await registerWrapper();
    await env.TRACKER_DB.prepare(
      `INSERT INTO wrapper_event_rate_buckets (
         token, utc_day, event_kind, event_count, updated_at
       )
       VALUES (?1, '2000-01-01', 'view', 12, '2000-01-01T00:00:00.000Z')`,
    )
      .bind(TOKEN_A)
      .run();

    const accepted = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_A,
    });
    expect(accepted.status).toBe(202);
    await accepted.text();

    const buckets = await env.TRACKER_DB.prepare(
      `SELECT utc_day, event_count
         FROM wrapper_event_rate_buckets
        WHERE token = ?1
          AND event_kind = 'view'`,
    )
      .bind(TOKEN_A)
      .all<{ utc_day: string; event_count: number }>();
    expect(buckets.results).toEqual([
      {
        utc_day: new Date().toISOString().slice(0, 10),
        event_count: 1,
      },
    ]);
  });

  it("rejects under-threshold dwell and strict-shape violations", async () => {
    await registerWrapper();

    const underThreshold = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_A,
      engagement_kind: "dwell",
      dwell_ms: 9_999,
    });
    expect(underThreshold.status).toBe(400);
    expect(await json(underThreshold)).toEqual({
      error: "invalid_wrapper_event",
    });

    const ctaWithDwell = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_B,
      engagement_kind: "cta",
      dwell_ms: 10_000,
    });
    expect(ctaWithDwell.status).toBe(400);

    const contactField = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_C,
      contact_id: "contact-123",
    });
    expect(contactField.status).toBe(400);

    const oversized = await wrapperEvent({
      padding: "x".repeat(16 * 1024),
    });
    expect(oversized.status).toBe(413);
    expect(await json(oversized)).toEqual({ error: "request_too_large" });

    const after = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 10 }),
    );
    expect(after.events).toEqual([]);
  });

  it("returns a conflict when one client UUID is reused for different evidence", async () => {
    await registerWrapper();
    await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_A,
    });

    const conflict = await wrapperEvent({
      event_type: "wrapper_engaged",
      client_event_id: CLIENT_EVENT_A,
      engagement_kind: "cta",
    });
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toEqual({
      error: "client_event_conflict",
    });
  });

  it("does not accept events for unknown, redirect, expired, or revoked tokens", async () => {
    const unknown = await wrapperEvent({
      event_type: "wrapper_viewed",
      client_event_id: CLIENT_EVENT_A,
    });
    expect(unknown.status).toBe(404);

    await register(TOKEN_B);
    const redirect = await wrapperEvent(
      {
        event_type: "wrapper_viewed",
        client_event_id: CLIENT_EVENT_B,
      },
      TOKEN_B,
    );
    expect(redirect.status).toBe(404);

    const expiredPayload = wrapperPayload(TOKEN_C);
    expiredPayload.expires_at = "2025-01-01T00:00:00Z";
    const rejectedExpiry = await registerWrapper(expiredPayload);
    expect(rejectedExpiry.status).toBe(400);
    expect(await json(rejectedExpiry)).toEqual({ error: "invalid_expiry" });

    // Simulate a once-live wrapper whose immutable absolute expiry has since
    // elapsed; registration itself no longer permits already-expired values.
    await env.TRACKER_DB.batch([
      env.TRACKER_DB.prepare(
        `INSERT INTO tracked_links (
           token, target_url, status, expires_at, created_at, updated_at,
           revoked_at, link_kind
         )
         VALUES (?1, ?2, 'active', ?3, ?4, ?4, NULL, 'wrapper')`,
      ).bind(
        TOKEN_C,
        "https://www.zillow.com/homedetails/expired/",
        "2025-01-01T00:00:00.000Z",
        "2024-12-01T00:00:00.000Z",
      ),
      env.TRACKER_DB.prepare(
        `INSERT INTO wrapper_pages (
           token, schema_version, content_hash, dwell_threshold_seconds,
           listing_address, property_intro, ryan_note, fact_sections_json,
           hero_json, created_at
         )
         VALUES (?1, 1, ?2, 10, ?3, ?4, ?5, '[]', ?6, ?7)`,
      ).bind(
        TOKEN_C,
        WRAPPER_HASH,
        "456 Past View Drive, Oceanside, CA 92054",
        "This test row represents a wrapper that was once available.",
        "Its fixed expiry remains immutable after registration.",
        JSON.stringify({ kind: "location_marker" }),
        "2024-12-01T00:00:00.000Z",
      ),
    ]);
    const expired = await wrapperEvent(
      {
        event_type: "wrapper_viewed",
        client_event_id: CLIENT_EVENT_C,
      },
      TOKEN_C,
    );
    expect(expired.status).toBe(410);

    await registerWrapper(wrapperPayload(TOKEN_A));
    await admin("/admin/links/revoke", { token: TOKEN_A });
    const revoked = await wrapperEvent(
      {
        event_type: "wrapper_viewed",
        client_event_id: CLIENT_EVENT_C,
      },
      TOKEN_A,
    );
    expect(revoked.status).toBe(410);
  });

  it("keeps redirect drain objects byte-compatible beside wrapper rows", async () => {
    await register(TOKEN_A);
    await registerWrapper(wrapperPayload(TOKEN_B));
    await (
      await worker.fetch(
        request(`https://homes.ryangallop.com/l/${TOKEN_A}`),
        env,
      )
    ).text();
    await wrapperEvent(
      {
        event_type: "wrapper_viewed",
        client_event_id: CLIENT_EVENT_A,
      },
      TOKEN_B,
    );

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 10 }),
    );
    const linkRequested = drained.events.find(
      (event) => event.event_type === "link_requested",
    );
    expect(Object.keys(linkRequested ?? {}).sort()).toEqual(
      [
        "event_type",
        "id",
        "occurred_at",
        "request_class",
        "token",
      ].sort(),
    );
    const wrapperViewed = drained.events.find(
      (event) => event.event_type === "wrapper_viewed",
    );
    expect(wrapperViewed).toMatchObject({
      client_event_id: CLIENT_EVENT_A,
      engagement_kind: null,
      dwell_ms: null,
    });
  });
});

describe("public tracked links", () => {
  it("records a truthful weak event and redirects with privacy headers", async () => {
    await json(await register(TOKEN_A));

    const response = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
        },
      }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://www.zillow.com/homedetails/example/",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.text()).resolves.toBe("");

    const drain = await admin("/admin/events", { limit: 10 });
    expect(drain.status).toBe(200);
    const payload = await json<{ events: EdgeEvent[] }>(drain);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      token: TOKEN_A,
      event_type: "link_requested",
      request_class: "unclassified",
    });
    expect(payload.events[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
    );
    expect(Date.parse(payload.events[0]?.occurred_at ?? "")).not.toBeNaN();
  });

  it("classifies obvious machine traffic without retaining the user agent", async () => {
    await json(await register(TOKEN_A));
    const response = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`, {
        headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" },
      }),
      env,
    );
    expect(response.status).toBe(302);
    await response.text();

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", {}),
    );
    expect(drained.events).toHaveLength(1);
    expect(drained.events[0]?.request_class).toBe("suspected_machine");
    expect(drained.events[0]).not.toHaveProperty("user_agent");
    expect(drained.events[0]).not.toHaveProperty("ip");
  });

  it("HEAD resolves without recording engagement", async () => {
    await json(await register(TOKEN_A));
    const response = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`, {
        method: "HEAD",
        headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" },
      }),
      env,
    );
    expect(response.status).toBe(302);
    await response.text();

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", {}),
    );
    expect(drained.events).toEqual([]);
  });

  it("returns 404 for unknown tokens and 410 for revoked or expired links", async () => {
    const unknown = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`),
      env,
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    expect(await json(unknown)).toEqual({ error: "link_not_found" });

    await json(await register(TOKEN_A));
    await json(await admin("/admin/links/revoke", { token: TOKEN_A }));
    const revoked = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_A}`),
      env,
    );
    expect(revoked.status).toBe(410);
    expect(await json(revoked)).toEqual({ error: "link_unavailable" });

    await json(
      await register(
        TOKEN_B,
        "https://www.zillow.com/homedetails/expired/",
        "2025-01-01T00:00:00Z",
      ),
    );
    const expired = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_B}`),
      env,
    );
    expect(expired.status).toBe(410);
    expect(await json(expired)).toEqual({ error: "link_unavailable" });
  });

  it("fails open to the destination when the event insert fails", async () => {
    await json(await register(TOKEN_C));
    await env.TRACKER_DB.prepare(
      "ALTER TABLE link_events RENAME TO link_events_unavailable",
    ).run();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await worker.fetch(
      request(`https://homes.ryangallop.com/l/${TOKEN_C}`),
      env,
    );
    await env.TRACKER_DB.prepare(
      "ALTER TABLE link_events_unavailable RENAME TO link_events",
    ).run();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://www.zillow.com/homedetails/example/",
    );
    await response.text();

    expect(log).toHaveBeenCalledOnce();
    const logged = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toEqual({
      event: "link_event_insert_failed",
      route: "public_link",
      error_type: "Error",
    });
    expect(logged).not.toContain(TOKEN_C);

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", {}),
    );
    expect(drained.events).toEqual([]);
  });
});

describe("durable drain and acknowledgement", () => {
  it("accepts the full 500-id acknowledgement payload above 16 KiB", async () => {
    const ids = Array.from({ length: 500 }, (_, index) =>
      testUuid(1000 + index),
    );
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify({ ids }),
    ).byteLength;
    expect(encodedBytes).toBeGreaterThan(16 * 1024);
    expect(encodedBytes).toBeLessThanOrEqual(32 * 1024);

    const ack = await admin("/admin/events/ack", { ids });
    expect(ack.status).toBe(200);
    expect(await json(ack)).toEqual({ acked: 0 });

    const oversized = await admin("/admin/events/ack", {
      padding: "x".repeat(32 * 1024),
    });
    expect(oversized.status).toBe(413);
    expect(await json(oversized)).toEqual({ error: "request_too_large" });
  });

  it("acknowledges 100 event ids with one D1 statement", async () => {
    await json(await register(TOKEN_A));
    for (let index = 0; index < 100; index += 1) {
      await (
        await worker.fetch(
          request(`https://homes.ryangallop.com/l/${TOKEN_A}`),
          env,
        )
      ).text();
    }

    const drained = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 100 }),
    );
    expect(drained.events).toHaveLength(100);

    const batch = vi.spyOn(env.TRACKER_DB, "batch");
    const ack = await admin("/admin/events/ack", {
      ids: drained.events.map((event) => event.id),
    });

    expect(await json(ack)).toEqual({ acked: 100 });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(1);

    const afterAck = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 100 }),
    );
    expect(afterAck.events).toEqual([]);
  });

  it("replays until ack and deletes only acknowledged event ids", async () => {
    await json(await register(TOKEN_A));
    await json(
      await register(
        TOKEN_B,
        "https://www.zillow.com/homedetails/second/",
      ),
    );
    await (
      await worker.fetch(
        request(`https://homes.ryangallop.com/l/${TOKEN_A}`),
        env,
      )
    ).text();
    await (
      await worker.fetch(
        request(`https://homes.ryangallop.com/l/${TOKEN_B}`),
        env,
      )
    ).text();

    const firstDrain = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 1 }),
    );
    expect(firstDrain.events).toHaveLength(1);
    const firstId = firstDrain.events[0]?.id;
    expect(firstId).toBeDefined();

    const replay = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 1 }),
    );
    expect(replay.events[0]?.id).toBe(firstId);

    const ack = await admin("/admin/events/ack", { ids: [firstId] });
    expect(await json(ack)).toEqual({ acked: 1 });
    const repeatedAck = await admin("/admin/events/ack", {
      ids: [firstId, firstId],
    });
    expect(await json(repeatedAck)).toEqual({ acked: 0 });

    const remaining = await json<{ events: EdgeEvent[] }>(
      await admin("/admin/events", { limit: 10 }),
    );
    expect(remaining.events).toHaveLength(1);
    expect(remaining.events[0]?.id).not.toBe(firstId);
  });

  it("validates drain limits and ack ids", async () => {
    const limit = await admin("/admin/events", { limit: 501 });
    expect(limit.status).toBe(400);
    expect(await json(limit)).toEqual({ error: "invalid_drain_limit" });

    const ack = await admin("/admin/events/ack", { ids: ["not-a-uuid"] });
    expect(ack.status).toBe(400);
    expect(await json(ack)).toEqual({ error: "invalid_event_id" });
  });
});

interface EdgeEvent {
  id: string;
  token: string;
  event_type: "link_requested" | "wrapper_viewed" | "wrapper_engaged";
  occurred_at: string;
  request_class: "suspected_machine" | "unclassified";
  client_event_id?: string | null;
  engagement_kind?: "dwell" | "cta" | null;
  dwell_ms?: number | null;
}
