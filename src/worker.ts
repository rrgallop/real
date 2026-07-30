const CANONICAL_HOST = "homes.ryangallop.com";
const REDIRECT_HOSTS = new Set([
  "reinventingrealty.co",
  "www.reinventingrealty.co",
  "ryangallop.com",
  "www.ryangallop.com",
  "rgallop.com",
  "www.rgallop.com",
]);
const TRACKER_HOSTS = new Set([CANONICAL_HOST, ...REDIRECT_HOSTS]);

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ABSOLUTE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const SUSPECTED_MACHINE_PATTERN =
  /\b(?:bot|crawler|spider|preview|slackbot|facebookexternalhit|linkedinbot|twitterbot|discordbot|googleimageproxy|skypeuripreview|telegrambot|headless|curl|wget|python-requests|go-http-client|postmanruntime|urlscan|safelinks|barracuda|mimecast|proofpoint|messagelabs|bytespider)\b/i;
const EMAIL_VALUE_PATTERN =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9.-])/i;
const OPT_OUT_QUERY_KEYS = new Set([
  "unsubscribe",
  "unsub",
  "optout",
  "opt_out",
  "opt-out",
]);
const OPT_OUT_PATH_PARTS = new Set([
  "unsubscribe",
  "unsub",
  "optout",
  "opt_out",
]);
const SENSITIVE_QUERY_KEYS = new Set([
  "contact",
  "contact_id",
  "email",
  "email_address",
  "lead_id",
  "mobile",
  "phone",
  "phone_number",
  "recipient",
]);

const MAX_JSON_BYTES = 16 * 1024;
const DEFAULT_DRAIN_LIMIT = 100;
const MAX_EVENT_BATCH = 500;
const MAX_D1_BOUND_PARAMETERS = 100;

type LinkStatus = "active" | "revoked";
type RequestClass = "suspected_machine" | "unclassified";
type RouteName =
  | "admin_events"
  | "admin_events_ack"
  | "admin_links"
  | "admin_links_revoke"
  | "admin_unknown"
  | "public_link"
  | "static";

interface LinkRow {
  target_url: string;
  status: LinkStatus;
  expires_at: string | null;
}

interface LinkStatusRow {
  status: LinkStatus;
}

interface EdgeEventRow {
  id: string;
  token: string;
  event_type: "link_requested";
  occurred_at: string;
  request_class: RequestClass;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly responseHeaders?: HeadersInit,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

function redirectToCanonical(request: Request): Response {
  const destination = new URL(request.url);
  destination.protocol = "https:";
  destination.host = CANONICAL_HOST;
  return Response.redirect(destination.toString(), 308);
}

function addSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  secured.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  return secured;
}

function addPrivateHeaders(response: Response, includeNoIndex: boolean): Response {
  const privateResponse = addSecurityHeaders(response);
  privateResponse.headers.set("Cache-Control", "no-store");
  privateResponse.headers.set("Expires", "0");
  privateResponse.headers.set("Pragma", "no-cache");
  privateResponse.headers.set("Referrer-Policy", "no-referrer");
  if (includeNoIndex) {
    privateResponse.headers.set(
      "X-Robots-Tag",
      "noindex, nofollow, noarchive",
    );
  }
  return privateResponse;
}

function finalizeResponse(response: Response, route: RouteName): Response {
  if (route === "public_link") {
    return addPrivateHeaders(response, true);
  }
  if (route.startsWith("admin_")) {
    return addPrivateHeaders(response, true);
  }
  return addSecurityHeaders(response);
}

function routeName(pathname: string): RouteName {
  if (pathname === "/l" || pathname.startsWith("/l/")) {
    return "public_link";
  }
  if (pathname === "/admin/links") {
    return "admin_links";
  }
  if (pathname === "/admin/links/revoke") {
    return "admin_links_revoke";
  }
  if (pathname === "/admin/events") {
    return "admin_events";
  }
  if (pathname === "/admin/events/ack") {
    return "admin_events_ack";
  }
  if (pathname.startsWith("/admin/")) {
    return "admin_unknown";
  }
  return "static";
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  });
}

function errorResponse(error: HttpError): Response {
  return jsonResponse(
    { error: error.code },
    error.status,
    error.responseHeaders,
  );
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function logError(event: string, route: RouteName, error: unknown): void {
  // Route names never contain link tokens. Error messages are intentionally
  // omitted because platform/database errors can echo bound request data.
  console.error(
    JSON.stringify({
      event,
      route,
      error_type: errorType(error),
    }),
  );
}

async function handlePublicLink(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "method_not_allowed", {
      Allow: "GET, HEAD",
    });
  }

  const token = tokenFromPath(pathname);
  if (token === null) {
    throw new HttpError(404, "link_not_found");
  }

  const link = await env.TRACKER_DB.prepare(
    `SELECT target_url, status, expires_at
       FROM tracked_links
      WHERE token = ?1
      LIMIT 1`,
  )
    .bind(token)
    .first<LinkRow>();

  if (link === null) {
    throw new HttpError(404, "link_not_found");
  }
  if (link.status === "revoked" || isExpired(link.expires_at)) {
    throw new HttpError(410, "link_unavailable");
  }

  if (request.method === "GET") {
    try {
      await env.TRACKER_DB.prepare(
        `INSERT INTO link_events
           (id, token, event_type, occurred_at, request_class)
         VALUES (?1, ?2, 'link_requested', ?3, ?4)`,
      )
        .bind(
          crypto.randomUUID(),
          token,
          new Date().toISOString(),
          classifyRequest(request),
        )
        .run();
    } catch (error) {
      // Tracking must never strand a recipient. Resolution remains available
      // even when the event buffer has a transient write failure.
      logError("link_event_insert_failed", "public_link", error);
    }
  }

  return new Response(null, {
    status: 302,
    headers: { Location: link.target_url },
  });
}

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);

  if (request.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", { Allow: "POST" });
  }

  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case "/admin/links":
      return registerLink(request, env);
    case "/admin/links/revoke":
      return revokeLink(request, env);
    case "/admin/events":
      return drainEvents(request, env);
    case "/admin/events/ack":
      return acknowledgeEvents(request, env);
    default:
      throw new HttpError(404, "not_found");
  }
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.LINK_TRACKER_ADMIN_TOKEN) {
    throw new HttpError(500, "admin_not_configured");
  }

  const provided = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.LINK_TRACKER_ADMIN_TOKEN}`;
  if (!(await timingSafeStringEqual(provided, expected))) {
    throw new HttpError(401, "unauthorized", {
      "WWW-Authenticate": "Bearer",
    });
  }
}

async function timingSafeStringEqual(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function registerLink(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (
    !isStrictObject(body, ["token", "target_url", "expires_at"]) ||
    typeof body.token !== "string" ||
    typeof body.target_url !== "string"
  ) {
    throw new HttpError(400, "invalid_link");
  }

  const token = normalizeToken(body.token);
  const targetUrl = normalizeTargetUrl(body.target_url);
  const expiresAt = normalizeExpiry(body.expires_at);
  const now = new Date().toISOString();

  const insert = await env.TRACKER_DB.prepare(
    `INSERT OR IGNORE INTO tracked_links
       (token, target_url, status, expires_at, created_at, updated_at, revoked_at)
     VALUES (?1, ?2, 'active', ?3, ?4, ?4, NULL)`,
  )
    .bind(token, targetUrl, expiresAt, now)
    .run();

  const created = insert.meta.changes === 1;
  if (!created) {
    const existing = await env.TRACKER_DB.prepare(
      `SELECT status
         FROM tracked_links
        WHERE token = ?1
        LIMIT 1`,
    )
      .bind(token)
      .first<LinkStatusRow>();

    if (existing === null) {
      throw new HttpError(409, "link_registration_conflict");
    }
    if (existing.status === "revoked") {
      throw new HttpError(409, "link_revoked");
    }

    const update = await env.TRACKER_DB.prepare(
      `UPDATE tracked_links
          SET target_url = ?1,
              expires_at = ?2,
              updated_at = ?3
        WHERE token = ?4
          AND status = 'active'`,
    )
      .bind(targetUrl, expiresAt, now, token)
      .run();

    if (update.meta.changes !== 1) {
      throw new HttpError(409, "link_registration_conflict");
    }
  }

  return jsonResponse(
    {
      ok: true,
      created,
      status: "active",
      expires_at: expiresAt,
    },
    created ? 201 : 200,
  );
}

async function revokeLink(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (
    !isStrictObject(body, ["token"]) ||
    typeof body.token !== "string"
  ) {
    throw new HttpError(400, "invalid_link");
  }

  const token = normalizeToken(body.token);
  const now = new Date().toISOString();
  const update = await env.TRACKER_DB.prepare(
    `UPDATE tracked_links
        SET status = 'revoked',
            revoked_at = ?1,
            updated_at = ?1
      WHERE token = ?2
        AND status = 'active'`,
  )
    .bind(now, token)
    .run();

  if (update.meta.changes === 1) {
    return jsonResponse({
      ok: true,
      revoked: true,
      status: "revoked",
    });
  }

  const existing = await env.TRACKER_DB.prepare(
    `SELECT status
       FROM tracked_links
      WHERE token = ?1
      LIMIT 1`,
  )
    .bind(token)
    .first<LinkStatusRow>();

  if (existing === null) {
    throw new HttpError(404, "link_not_found");
  }
  if (existing.status !== "revoked") {
    throw new HttpError(409, "link_revocation_conflict");
  }

  return jsonResponse({
    ok: true,
    revoked: false,
    status: "revoked",
  });
}

async function drainEvents(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!isStrictObject(body, ["limit"])) {
    throw new HttpError(400, "invalid_drain_request");
  }

  let limit = DEFAULT_DRAIN_LIMIT;
  if (body.limit !== undefined) {
    if (
      typeof body.limit !== "number" ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > MAX_EVENT_BATCH
    ) {
      throw new HttpError(400, "invalid_drain_limit");
    }
    limit = body.limit;
  }

  const result = await env.TRACKER_DB.prepare(
    `SELECT id, token, event_type, occurred_at, request_class
       FROM link_events
      ORDER BY occurred_at ASC, id ASC
      LIMIT ?1`,
  )
    .bind(limit)
    .all<EdgeEventRow>();

  return jsonResponse({ events: result.results });
}

async function acknowledgeEvents(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson(request);
  if (!isStrictObject(body, ["ids"]) || !Array.isArray(body.ids)) {
    throw new HttpError(400, "invalid_ack_request");
  }
  if (body.ids.length > MAX_EVENT_BATCH) {
    throw new HttpError(400, "too_many_event_ids");
  }

  const ids: string[] = [];
  for (const value of body.ids) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new HttpError(400, "invalid_event_id");
    }
    if (!ids.includes(value)) {
      ids.push(value);
    }
  }

  if (ids.length === 0) {
    return jsonResponse({ acked: 0 });
  }

  const statements: D1PreparedStatement[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += MAX_D1_BOUND_PARAMETERS
  ) {
    const chunk = ids.slice(offset, offset + MAX_D1_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    statements.push(
      env.TRACKER_DB.prepare(
        `DELETE FROM link_events WHERE id IN (${placeholders})`,
      ).bind(...chunk),
    );
  }

  const results = await env.TRACKER_DB.batch(statements);
  const acked = results.reduce(
    (total, result) => total + result.meta.changes,
    0,
  );
  return jsonResponse({ acked });
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType === undefined ||
    (contentType !== "application/json" && !contentType.endsWith("+json"))
  ) {
    throw new HttpError(415, "json_content_type_required");
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isFinite(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_JSON_BYTES
    ) {
      throw new HttpError(413, "request_too_large");
    }
  }

  if (request.body === null) {
    throw new HttpError(400, "invalid_json");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "request_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function isStrictObject(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function normalizeToken(value: string): string {
  if (!TOKEN_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_token");
  }
  return value;
}

function tokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/l/")) {
    return null;
  }
  const token = pathname.slice("/l/".length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

function normalizeTargetUrl(value: string): string {
  if (value.length === 0 || value.length > 4096 || value !== value.trim()) {
    throw new HttpError(400, "invalid_target_url");
  }

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new HttpError(400, "invalid_target_url");
  }

  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    (target.port !== "" && target.port !== "443") ||
    !isPublicHostname(target.hostname)
  ) {
    throw new HttpError(400, "invalid_target_url");
  }

  if (
    TRACKER_HOSTS.has(target.hostname.toLowerCase().replace(/\.$/, "")) &&
    (target.pathname === "/l" || target.pathname.startsWith("/l/"))
  ) {
    throw new HttpError(400, "tracked_link_target_not_allowed");
  }

  const normalized = target.toString();
  if (normalized.length > 4096) {
    throw new HttpError(400, "invalid_target_url");
  }

  let decodedTarget: string;
  let decodedPath: string;
  try {
    decodedTarget = decodeURIComponent(normalized);
    decodedPath = decodeURIComponent(target.pathname);
  } catch {
    throw new HttpError(400, "invalid_target_url");
  }

  const pathParts = decodedPath
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase().replaceAll("-", "_"));
  if (pathParts.some((part) => OPT_OUT_PATH_PARTS.has(part))) {
    throw new HttpError(400, "invalid_target_url");
  }

  for (const key of target.searchParams.keys()) {
    const normalizedKey = key.toLowerCase();
    if (
      OPT_OUT_QUERY_KEYS.has(normalizedKey) ||
      SENSITIVE_QUERY_KEYS.has(normalizedKey)
    ) {
      throw new HttpError(400, "invalid_target_url");
    }
  }

  // The destination itself is necessarily retained at the edge. Reject a
  // visible email address even when it is percent-encoded in an otherwise
  // opaque query value or path.
  if (EMAIL_VALUE_PATTERN.test(decodedTarget)) {
    throw new HttpError(400, "invalid_target_url");
  }

  return normalized;
}

function isPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/\.$/, "");
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes(":") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".test")
  ) {
    return false;
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 !== null) {
    return isPublicIpv4(ipv4);
  }

  const labels = hostname.split(".");
  if (labels.length < 2 || (labels.at(-1)?.length ?? 0) < 2) {
    return false;
  }
  return labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  ) {
    return null;
  }
  const [first, second, third, fourth] = octets;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    return null;
  }
  return [first, second, third, fourth];
}

function isPublicIpv4(
  [first, second, third]: [number, number, number, number],
): boolean {
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function normalizeExpiry(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !ABSOLUTE_TIMESTAMP_PATTERN.test(value)
  ) {
    throw new HttpError(400, "invalid_expiry");
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, "invalid_expiry");
  }
  return new Date(timestamp).toISOString();
}

function isExpired(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function classifyRequest(request: Request): RequestClass {
  const userAgent = request.headers.get("User-Agent") ?? "";
  const purpose = [
    request.headers.get("Purpose"),
    request.headers.get("Sec-Purpose"),
    request.headers.get("X-Purpose"),
    request.headers.get("X-Moz"),
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  if (
    SUSPECTED_MACHINE_PATTERN.test(userAgent) ||
    /\b(?:prefetch|preview|prerender)\b/i.test(purpose)
  ) {
    return "suspected_machine";
  }
  return "unclassified";
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (REDIRECT_HOSTS.has(host)) {
      const redirect = redirectToCanonical(request);
      return routeName(url.pathname) === "public_link"
        ? finalizeResponse(redirect, "public_link")
        : redirect;
    }

    const route = routeName(url.pathname);
    try {
      if (route === "public_link") {
        return finalizeResponse(
          await handlePublicLink(request, env, url.pathname),
          route,
        );
      }
      if (route.startsWith("admin_")) {
        return finalizeResponse(await handleAdmin(request, env), route);
      }

      const response = await env.ASSETS.fetch(request);
      return finalizeResponse(response, route);
    } catch (error) {
      if (error instanceof HttpError) {
        return finalizeResponse(errorResponse(error), route);
      }

      logError("request_failed", route, error);
      const response =
        route === "static"
          ? new Response("Internal Server Error", { status: 500 })
          : jsonResponse({ error: "internal_error" }, 500);
      return finalizeResponse(response, route);
    }
  },
} satisfies ExportedHandler<Env>;
