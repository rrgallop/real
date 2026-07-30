import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/worker";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const ADMIN_TOKEN = "test-admin-secret";
const TOKEN_A = "AbCdEfGhIjKlMnOpQrStUv";
const TOKEN_B = "ZyXwVuTsRqPoNmLkJiHgFe";
const TOKEN_C = "0123456789_-AbCdEfGhIj";

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

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.TRACKER_DB.batch([
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
    expect(linkColumns.results.map((column) => column.name)).toEqual([
      "token",
      "target_url",
      "status",
      "expires_at",
      "created_at",
      "updated_at",
      "revoked_at",
    ]);
    expect(eventColumns.results.map((column) => column.name)).toEqual([
      "id",
      "token",
      "event_type",
      "occurred_at",
      "request_class",
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
  event_type: "link_requested";
  occurred_at: string;
  request_class: "suspected_machine" | "unclassified";
}
