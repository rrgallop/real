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
const ZILLOW_HOST = "zillow.com";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ABSOLUTE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const SUSPECTED_MACHINE_PATTERN =
  /\b(?:bot|crawler|spider|preview|slackbot|facebookexternalhit|linkedinbot|twitterbot|discordbot|googleimageproxy|skypeuripreview|telegrambot|headless|curl|wget|python-requests|go-http-client|postmanruntime|urlscan|safelinks|barracuda|mimecast|proofpoint|messagelabs|bytespider)\b/i;
const EMAIL_VALUE_PATTERN =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9.-])/i;
const PHONE_VALUE_PATTERN =
  /(?:\+?1[\s().-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}/;
const URL_VALUE_PATTERN =
  /\b(?:https?:\/\/|www\.|data:image\/|[a-z0-9-]+\.(?:com|net|org|io|co|us)\/)/i;
const IMAGE_FILE_PATTERN =
  /\b[^\s]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s]*)?\b/i;
const MARKDOWN_VALUE_PATTERN =
  /(?:!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~)|[*_]{2}|`)/m;
const DISALLOWED_TEXT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const RAW_URL_WHITESPACE_OR_CONTROL_PATTERN = /[\u0000-\u0020\u007f]/;
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

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;
const MAX_ACK_JSON_BYTES = 32 * 1024;
const MAX_WRAPPER_REGISTRATION_JSON_BYTES = 64 * 1024;
const DEFAULT_DRAIN_LIMIT = 100;
const MAX_EVENT_BATCH = 500;
const MAX_D1_BOUND_PARAMETERS = 100;
const MAX_DWELL_MS = 3_600_000;
const WRAPPER_SCHEMA_VERSION = 1;
const WRAPPER_EVENT_RATE_LIMIT_CODE = "wrapper_event_rate_limited";

type LinkStatus = "active" | "revoked";
type LinkKind = "redirect" | "wrapper";
type RequestClass = "suspected_machine" | "unclassified";
type WrapperEventType = "wrapper_viewed" | "wrapper_engaged";
type EngagementKind = "dwell" | "cta";
type RouteName =
  | "admin_events"
  | "admin_events_ack"
  | "admin_campaign_unsubscribes"
  | "admin_campaign_unsubscribe_events"
  | "admin_campaign_unsubscribe_events_ack"
  | "admin_links"
  | "admin_links_revoke"
  | "admin_wrappers"
  | "admin_unknown"
  | "public_link"
  | "public_unsubscribe"
  | "public_wrapper"
  | "static";

interface LinkRow {
  target_url: string;
  status: LinkStatus;
  expires_at: string | null;
  link_kind: LinkKind;
}

interface LinkStatusRow {
  status: LinkStatus;
  link_kind: LinkKind;
}

interface EdgeEventRow {
  id: string;
  token: string;
  event_type: "link_requested" | WrapperEventType;
  occurred_at: string;
  request_class: RequestClass;
  engagement_kind: EngagementKind | null;
  dwell_ms: number | null;
  client_event_id: string | null;
}

interface WrapperPageRow extends LinkRow {
  schema_version: number;
  content_hash: string;
  dwell_threshold_seconds: number;
  listing_address: string;
  property_intro: string;
  ryan_note: string;
  fact_sections_json: string;
  hero_json: string;
}

interface ExistingClientEventRow {
  token: string;
  event_type: WrapperEventType;
  engagement_kind: EngagementKind | null;
  dwell_ms: number | null;
}

interface CampaignUnsubscribeTokenRow {
  token_hash: string;
  campaign_id: string;
  enrollment_id: string;
  marketing_category: string;
  expires_at: string | null;
}

interface CampaignUnsubscribeEventRow {
  id: string;
  campaign_id: string;
  enrollment_id: string;
  marketing_category: string;
  occurred_at: string;
}

interface CampaignUnsubscribeRegistration {
  token: string;
  campaignId: string;
  enrollmentId: string;
  marketingCategory: string;
  expiresAt: string | null;
}

interface NormalizedWrapperEvent {
  eventType: WrapperEventType;
  clientEventId: string;
  engagementKind: EngagementKind | null;
  dwellMs: number | null;
}

interface FactSection {
  label: string;
  text: string;
}

interface LocationMarkerHero {
  kind: "location_marker";
}

interface ComparisonBar {
  label: string;
  value: number;
}

interface ComparisonChartHero {
  kind: "comparison_chart";
  title: string;
  bars: ComparisonBar[];
}

type WrapperHero = LocationMarkerHero | ComparisonChartHero;

interface WrapperContent {
  listing_address: string;
  property_intro: string;
  ryan_note: string;
  fact_sections: FactSection[];
  hero: WrapperHero;
}

interface WrapperRegistration {
  token: string;
  targetUrl: string;
  expiresAt: string | null;
  schemaVersion: 1;
  contentHash: string;
  dwellThresholdSeconds: number;
  content: WrapperContent;
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

function addWrapperHeaders(response: Response): Response {
  const wrapped = addPrivateHeaders(response, true);
  wrapped.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self'",
      "manifest-src 'none'",
      "media-src 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  wrapped.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  wrapped.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  wrapped.headers.set("Origin-Agent-Cluster", "?1");
  return wrapped;
}

function addUnsubscribeHeaders(response: Response): Response {
  const unsubscribe = addPrivateHeaders(response, true);
  // This page intentionally has no scripts or external resources. Allow inline
  // styles solely so the confirmation can remain readable without widening the
  // capability-bearing unsubscribe URL to any other origin.
  unsubscribe.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'none'",
      "style-src 'unsafe-inline'",
    ].join("; "),
  );
  return unsubscribe;
}

function finalizeResponse(response: Response, route: RouteName): Response {
  if (route === "public_wrapper") {
    return addWrapperHeaders(response);
  }
  if (route === "public_link") {
    return addPrivateHeaders(response, true);
  }
  if (route === "public_unsubscribe") {
    return addUnsubscribeHeaders(response);
  }
  if (route.startsWith("admin_")) {
    return addPrivateHeaders(response, true);
  }
  return addSecurityHeaders(response);
}

function routeName(pathname: string): RouteName {
  if (pathname === "/w" || pathname.startsWith("/w/")) {
    return "public_wrapper";
  }
  if (pathname === "/l" || pathname.startsWith("/l/")) {
    return "public_link";
  }
  if (pathname === "/u" || pathname.startsWith("/u/")) {
    return "public_unsubscribe";
  }
  if (pathname === "/admin/wrappers") {
    return "admin_wrappers";
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
  if (pathname === "/admin/campaign-unsubscribes") {
    return "admin_campaign_unsubscribes";
  }
  if (pathname === "/admin/campaign-unsubscribes/events") {
    return "admin_campaign_unsubscribe_events";
  }
  if (pathname === "/admin/campaign-unsubscribes/events/ack") {
    return "admin_campaign_unsubscribe_events_ack";
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
    `SELECT target_url, status, expires_at, link_kind
       FROM tracked_links
      WHERE token = ?1
        AND link_kind = 'redirect'
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

async function handlePublicUnsubscribe(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "POST"
  ) {
    throw new HttpError(405, "method_not_allowed", {
      Allow: "GET, HEAD, POST",
    });
  }

  const token = unsubscribeTokenFromPath(pathname);
  if (token === null) {
    throw new HttpError(404, "unsubscribe_not_found");
  }

  const registration = await getCampaignUnsubscribeToken(
    env,
    await sha256Hex(token),
  );
  assertCampaignUnsubscribeAvailable(registration);

  // RFC 8058 one-click requests are unauthenticated HTTPS POSTs. Deliberately
  // ignore cookies, Origin, query data, and POST body; the opaque URL token is
  // the only capability required, and a visible confirmation form posts to
  // this identical endpoint without any hidden recipient data.
  if (request.method === "POST") {
    const event = await recordCampaignUnsubscribe(env, registration);
    return new Response(renderCampaignUnsubscribeCompletePage(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Unsubscribe-Recorded": event.created ? "true" : "false",
      },
    });
  }

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
  });
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(renderCampaignUnsubscribeConfirmationPage(token), {
    status: 200,
    headers,
  });
}

async function getCampaignUnsubscribeToken(
  env: Env,
  tokenHash: string,
): Promise<CampaignUnsubscribeTokenRow | null> {
  return env.TRACKER_DB.prepare(
    `SELECT token_hash, campaign_id, enrollment_id, marketing_category, expires_at
       FROM campaign_unsubscribe_tokens
      WHERE token_hash = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<CampaignUnsubscribeTokenRow>();
}

function assertCampaignUnsubscribeAvailable(
  registration: CampaignUnsubscribeTokenRow | null,
): asserts registration is CampaignUnsubscribeTokenRow {
  if (registration === null) {
    throw new HttpError(404, "unsubscribe_not_found");
  }
  if (isExpired(registration.expires_at)) {
    throw new HttpError(410, "unsubscribe_unavailable");
  }
}

async function recordCampaignUnsubscribe(
  env: Env,
  registration: CampaignUnsubscribeTokenRow,
): Promise<{ created: boolean }> {
  const inserted = await env.TRACKER_DB.prepare(
    `INSERT OR IGNORE INTO campaign_unsubscribe_events (
       id,
       token_hash,
       campaign_id,
       enrollment_id,
       marketing_category,
       occurred_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      crypto.randomUUID(),
      registration.token_hash,
      registration.campaign_id,
      registration.enrollment_id,
      registration.marketing_category,
      new Date().toISOString(),
    )
    .run();
  return { created: inserted.meta.changes === 1 };
}

function renderCampaignUnsubscribeConfirmationPage(token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <title>Confirm unsubscribe</title>
  </head>
  <body>
    <main>
      <h1>Unsubscribe from marketing emails</h1>
      <p>This stops future messages in this email category. It does not affect transaction or service updates.</p>
      <form method="post" action="/u/${escapeHtml(token)}">
        <button type="submit">Unsubscribe</button>
      </form>
    </main>
  </body>
</html>`;
}

function renderCampaignUnsubscribeCompletePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <title>Unsubscribed</title>
  </head>
  <body>
    <main>
      <h1>You are unsubscribed</h1>
      <p>Your request has been recorded.</p>
    </main>
  </body>
</html>`;
}

async function handlePublicWrapper(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const route = wrapperRouteFromPath(pathname);
  if (route === null) {
    throw new HttpError(404, "wrapper_not_found");
  }

  if (route.kind === "events") {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", { Allow: "POST" });
    }
    return recordWrapperEvent(request, env, route.token);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "method_not_allowed", {
      Allow: "GET, HEAD",
    });
  }

  const page = await getWrapperPage(env, route.token);
  assertWrapperAvailable(page);

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
  });
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(renderWrapperPage(route.token, page), {
    status: 200,
    headers,
  });
}

async function getWrapperPage(
  env: Env,
  token: string,
): Promise<WrapperPageRow | null> {
  return env.TRACKER_DB.prepare(
    `SELECT
       tracked_links.target_url,
       tracked_links.status,
       tracked_links.expires_at,
       tracked_links.link_kind,
       wrapper_pages.schema_version,
       wrapper_pages.content_hash,
       wrapper_pages.dwell_threshold_seconds,
       wrapper_pages.listing_address,
       wrapper_pages.property_intro,
       wrapper_pages.ryan_note,
       wrapper_pages.fact_sections_json,
       wrapper_pages.hero_json
     FROM tracked_links
     JOIN wrapper_pages
       ON wrapper_pages.token = tracked_links.token
    WHERE tracked_links.token = ?1
      AND tracked_links.link_kind = 'wrapper'
    LIMIT 1`,
  )
    .bind(token)
    .first<WrapperPageRow>();
}

function assertWrapperAvailable(
  page: WrapperPageRow | null,
): asserts page is WrapperPageRow {
  if (page === null) {
    throw new HttpError(404, "wrapper_not_found");
  }
  if (page.status === "revoked" || isExpired(page.expires_at)) {
    throw new HttpError(410, "wrapper_unavailable");
  }
}

async function recordWrapperEvent(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  const page = await getWrapperPage(env, token);
  assertWrapperAvailable(page);

  const event = normalizeWrapperEvent(
    await readJson(request),
    page.dwell_threshold_seconds,
  );
  const existing = await getExistingClientEvent(env, event.clientEventId);
  if (existing !== null) {
    return wrapperEventReplayResponse(existing, event, token);
  }

  const occurredAt = new Date().toISOString();
  let insert: D1Result;
  try {
    insert = await env.TRACKER_DB.prepare(
      `INSERT INTO link_events (
         id,
         token,
         event_type,
         occurred_at,
         request_class,
         engagement_kind,
         dwell_ms,
         client_event_id
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        WHERE EXISTS (
          SELECT 1
            FROM tracked_links
            JOIN wrapper_pages
              ON wrapper_pages.token = tracked_links.token
           WHERE tracked_links.token = ?2
             AND tracked_links.link_kind = 'wrapper'
             AND tracked_links.status = 'active'
             AND (
               tracked_links.expires_at IS NULL
               OR tracked_links.expires_at > ?4
             )
        )`,
    )
      .bind(
        crypto.randomUUID(),
        token,
        event.eventType,
        occurredAt,
        classifyRequest(request),
        event.engagementKind,
        event.dwellMs,
        event.clientEventId,
      )
      .run();
  } catch (error) {
    // A concurrent request with the same client id may win after our initial
    // read. The database trigger skips its quota increment before the unique
    // constraint resolves that race, so this remains an idempotent replay.
    const racedEvent = await getExistingClientEvent(env, event.clientEventId);
    if (racedEvent !== null) {
      return wrapperEventReplayResponse(racedEvent, event, token);
    }
    if (errorContainsCode(error, WRAPPER_EVENT_RATE_LIMIT_CODE)) {
      throw new HttpError(429, WRAPPER_EVENT_RATE_LIMIT_CODE, {
        "Retry-After": retryAfterNextUtcDay(occurredAt),
      });
    }
    throw error;
  }

  // D1 includes trigger writes in meta.changes, so a successful event can
  // report more than one changed row (the event plus its rate bucket).
  if (insert.meta.changes > 0) {
    return jsonResponse({ ok: true, recorded: true }, 202);
  }

  // The conditional insert can lose a race with revocation or expiry. Resolve
  // current state rather than misreporting that the event was accepted.
  assertWrapperAvailable(await getWrapperPage(env, token));
  throw new HttpError(409, "event_not_recorded");
}

async function getExistingClientEvent(
  env: Env,
  clientEventId: string,
): Promise<ExistingClientEventRow | null> {
  return env.TRACKER_DB.prepare(
    `SELECT token, event_type, engagement_kind, dwell_ms
       FROM link_events
      WHERE client_event_id = ?1
      LIMIT 1`,
  )
    .bind(clientEventId)
    .first<ExistingClientEventRow>();
}

function wrapperEventReplayResponse(
  existing: ExistingClientEventRow,
  event: NormalizedWrapperEvent,
  token: string,
): Response {
  if (
    existing.token !== token ||
    existing.event_type !== event.eventType ||
    existing.engagement_kind !== event.engagementKind ||
    existing.dwell_ms !== event.dwellMs
  ) {
    throw new HttpError(409, "client_event_conflict");
  }
  return jsonResponse({ ok: true, recorded: false }, 202);
}

function errorContainsCode(error: unknown, code: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) {
      return false;
    }
    if (current.message.includes(code)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function retryAfterNextUtcDay(occurredAt: string): string {
  const occurredAtMs = Date.parse(occurredAt);
  const occurredAtDate = new Date(occurredAtMs);
  const nextDayMs = Date.UTC(
    occurredAtDate.getUTCFullYear(),
    occurredAtDate.getUTCMonth(),
    occurredAtDate.getUTCDate() + 1,
  );
  return String(Math.max(1, Math.ceil((nextDayMs - occurredAtMs) / 1000)));
}

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);

  if (request.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", { Allow: "POST" });
  }

  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case "/admin/wrappers":
      return registerWrapper(request, env);
    case "/admin/links":
      return registerLink(request, env);
    case "/admin/links/revoke":
      return revokeLink(request, env);
    case "/admin/events":
      return drainEvents(request, env);
    case "/admin/events/ack":
      return acknowledgeEvents(request, env);
    case "/admin/campaign-unsubscribes":
      return registerCampaignUnsubscribe(request, env);
    case "/admin/campaign-unsubscribes/events":
      return drainCampaignUnsubscribeEvents(request, env);
    case "/admin/campaign-unsubscribes/events/ack":
      return acknowledgeCampaignUnsubscribeEvents(request, env);
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function registerCampaignUnsubscribe(
  request: Request,
  env: Env,
): Promise<Response> {
  const registration = normalizeCampaignUnsubscribeRegistration(
    await readJson(request),
  );
  const tokenHash = await sha256Hex(registration.token);
  const now = new Date().toISOString();
  const insert = await env.TRACKER_DB.prepare(
    `INSERT OR IGNORE INTO campaign_unsubscribe_tokens (
       token_hash,
       campaign_id,
       enrollment_id,
       marketing_category,
       expires_at,
       created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      tokenHash,
      registration.campaignId,
      registration.enrollmentId,
      registration.marketingCategory,
      registration.expiresAt,
      now,
    )
    .run();

  if (insert.meta.changes === 1) {
    return jsonResponse(
      {
        ok: true,
        created: true,
        expires_at: registration.expiresAt,
      },
      201,
    );
  }

  const existing = await getCampaignUnsubscribeToken(env, tokenHash);
  if (
    existing === null ||
    existing.campaign_id !== registration.campaignId ||
    existing.enrollment_id !== registration.enrollmentId ||
    existing.marketing_category !== registration.marketingCategory ||
    existing.expires_at !== registration.expiresAt
  ) {
    // Tokens are email capabilities after dispatch. Never allow a retry or a
    // later request to repoint an already-issued token to another enrollment.
    throw new HttpError(409, "unsubscribe_registration_conflict");
  }

  return jsonResponse({
    ok: true,
    created: false,
    expires_at: existing.expires_at,
  });
}

async function drainCampaignUnsubscribeEvents(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson(request);
  if (!isStrictObject(body, ["limit"])) {
    throw new HttpError(400, "invalid_drain_request");
  }

  const limit = normalizeDrainLimit(body.limit);
  const result = await env.TRACKER_DB.prepare(
    `SELECT
       event.id,
       event.campaign_id,
       event.enrollment_id,
       event.marketing_category,
       event.occurred_at
     FROM campaign_unsubscribe_events AS event
     LEFT JOIN campaign_unsubscribe_event_acks AS acknowledgement
       ON acknowledgement.event_id = event.id
     WHERE acknowledgement.event_id IS NULL
     ORDER BY event.occurred_at ASC, event.id ASC
     LIMIT ?1`,
  )
    .bind(limit)
    .all<CampaignUnsubscribeEventRow>();

  return jsonResponse({ events: result.results });
}

async function acknowledgeCampaignUnsubscribeEvents(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson(request, MAX_ACK_JSON_BYTES);
  if (!isStrictObject(body, ["ids"]) || !Array.isArray(body.ids)) {
    throw new HttpError(400, "invalid_ack_request");
  }
  if (body.ids.length > MAX_EVENT_BATCH) {
    throw new HttpError(400, "too_many_event_ids");
  }

  const ids = normalizeEventIds(body.ids);
  if (ids.length === 0) {
    return jsonResponse({ acked: 0 });
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += MAX_D1_BOUND_PARAMETERS - 1
  ) {
    const chunk = ids.slice(offset, offset + MAX_D1_BOUND_PARAMETERS - 1);
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(", ");
    statements.push(
      env.TRACKER_DB.prepare(
        `INSERT OR IGNORE INTO campaign_unsubscribe_event_acks (
           event_id,
           acknowledged_at
         )
         SELECT id, ?1
           FROM campaign_unsubscribe_events
          WHERE id IN (${placeholders})`,
      ).bind(now, ...chunk),
    );
  }

  const results = await env.TRACKER_DB.batch(statements);
  const acked = results.reduce(
    (total, result) => total + result.meta.changes,
    0,
  );
  return jsonResponse({ acked });
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
       (
         token,
         target_url,
         status,
         expires_at,
         created_at,
         updated_at,
         revoked_at,
         link_kind
       )
     VALUES (?1, ?2, 'active', ?3, ?4, ?4, NULL, 'redirect')`,
  )
    .bind(token, targetUrl, expiresAt, now)
    .run();

  const created = insert.meta.changes === 1;
  if (!created) {
    const existing = await env.TRACKER_DB.prepare(
      `SELECT status, link_kind
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
    if (existing.link_kind !== "redirect") {
      throw new HttpError(409, "link_registration_conflict");
    }

    const update = await env.TRACKER_DB.prepare(
      `UPDATE tracked_links
          SET target_url = ?1,
              expires_at = ?2,
              updated_at = ?3
        WHERE token = ?4
          AND status = 'active'
          AND link_kind = 'redirect'`,
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

async function registerWrapper(
  request: Request,
  env: Env,
): Promise<Response> {
  const registration = normalizeWrapperRegistration(
    await readJson(request, MAX_WRAPPER_REGISTRATION_JSON_BYTES),
  );
  const now = new Date().toISOString();
  const factSectionsJson = JSON.stringify(registration.content.fact_sections);
  const heroJson = JSON.stringify(registration.content.hero);

  const existingLink = await env.TRACKER_DB.prepare(
    `SELECT target_url, status, expires_at, link_kind
       FROM tracked_links
      WHERE token = ?1
      LIMIT 1`,
  )
    .bind(registration.token)
    .first<LinkRow>();

  if (existingLink !== null) {
    return wrapperRetryResponse(
      registration,
      existingLink,
      await getWrapperPage(env, registration.token),
      factSectionsJson,
      heroJson,
    );
  }

  try {
    await env.TRACKER_DB.batch([
      env.TRACKER_DB.prepare(
        `INSERT INTO tracked_links (
           token,
           target_url,
           status,
           expires_at,
           created_at,
           updated_at,
           revoked_at,
           link_kind
         )
         VALUES (?1, ?2, 'active', ?3, ?4, ?4, NULL, 'wrapper')`,
      ).bind(
        registration.token,
        registration.targetUrl,
        registration.expiresAt,
        now,
      ),
      env.TRACKER_DB.prepare(
        `INSERT INTO wrapper_pages (
           token,
           schema_version,
           content_hash,
           dwell_threshold_seconds,
           listing_address,
           property_intro,
           ryan_note,
           fact_sections_json,
           hero_json,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        registration.token,
        registration.schemaVersion,
        registration.contentHash,
        registration.dwellThresholdSeconds,
        registration.content.listing_address,
        registration.content.property_intro,
        registration.content.ryan_note,
        factSectionsJson,
        heroJson,
        now,
      ),
    ]);
  } catch (error) {
    // An identical concurrent registration may win the unique-token race.
    // Re-read it and honor idempotency; unrelated D1 failures still surface.
    const racedLink = await env.TRACKER_DB.prepare(
      `SELECT target_url, status, expires_at, link_kind
         FROM tracked_links
        WHERE token = ?1
        LIMIT 1`,
    )
      .bind(registration.token)
      .first<LinkRow>();
    if (racedLink === null) {
      throw error;
    }
    return wrapperRetryResponse(
      registration,
      racedLink,
      await getWrapperPage(env, registration.token),
      factSectionsJson,
      heroJson,
    );
  }

  return jsonResponse(
    {
      ok: true,
      created: true,
      status: "active",
      expires_at: registration.expiresAt,
      content_hash: registration.contentHash,
    },
    201,
  );
}

function wrapperRetryResponse(
  registration: WrapperRegistration,
  link: LinkRow,
  page: WrapperPageRow | null,
  factSectionsJson: string,
  heroJson: string,
): Response {
  if (
    link.link_kind !== "wrapper" ||
    page === null ||
    link.target_url !== registration.targetUrl ||
    link.expires_at !== registration.expiresAt ||
    page.schema_version !== registration.schemaVersion ||
    page.content_hash !== registration.contentHash ||
    page.dwell_threshold_seconds !== registration.dwellThresholdSeconds ||
    page.listing_address !== registration.content.listing_address ||
    page.property_intro !== registration.content.property_intro ||
    page.ryan_note !== registration.content.ryan_note ||
    page.fact_sections_json !== factSectionsJson ||
    page.hero_json !== heroJson
  ) {
    throw new HttpError(409, "wrapper_conflict");
  }

  return jsonResponse({
    ok: true,
    created: false,
    status: link.status,
    expires_at: link.expires_at,
    content_hash: page.content_hash,
  });
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
    `SELECT status, link_kind
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
    `SELECT
       id,
       token,
       event_type,
       occurred_at,
       request_class,
       engagement_kind,
       dwell_ms,
       client_event_id
       FROM link_events
      ORDER BY occurred_at ASC, id ASC
      LIMIT ?1`,
  )
    .bind(limit)
    .all<EdgeEventRow>();

  const events = result.results.map((event) => {
    const base = {
      id: event.id,
      token: event.token,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      request_class: event.request_class,
    };
    if (event.event_type === "link_requested") {
      return base;
    }
    return {
      ...base,
      client_event_id: event.client_event_id,
      engagement_kind: event.engagement_kind,
      dwell_ms: event.dwell_ms,
    };
  });

  return jsonResponse({ events });
}

async function acknowledgeEvents(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson(request, MAX_ACK_JSON_BYTES);
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

async function readJson(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
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
      parsedLength > maxBytes
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
    if (total > maxBytes) {
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

function isExactObject(
  value: unknown,
  exactKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    isStrictObject(value, exactKeys) &&
    Object.keys(value).length === exactKeys.length &&
    exactKeys.every((key) => Object.hasOwn(value, key))
  );
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

function unsubscribeTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/u/")) {
    return null;
  }
  const token = pathname.slice("/u/".length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

function normalizeCampaignUnsubscribeRegistration(
  value: unknown,
): CampaignUnsubscribeRegistration {
  const keys = [
    "token",
    "campaign_id",
    "enrollment_id",
    "marketing_category",
    "expires_at",
  ] as const;
  if (
    !isExactObject(value, keys) ||
    typeof value.token !== "string" ||
    typeof value.campaign_id !== "string" ||
    typeof value.enrollment_id !== "string" ||
    typeof value.marketing_category !== "string"
  ) {
    throw new HttpError(400, "invalid_campaign_unsubscribe");
  }

  return {
    token: normalizeToken(value.token),
    campaignId: normalizeOpaqueUuid(value.campaign_id),
    enrollmentId: normalizeOpaqueUuid(value.enrollment_id),
    marketingCategory: normalizeMarketingCategory(value.marketing_category),
    expiresAt: normalizeExpiry(value.expires_at),
  };
}

function normalizeOpaqueUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_campaign_unsubscribe");
  }
  return value.toLowerCase();
}

function normalizeMarketingCategory(value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new HttpError(400, "invalid_campaign_unsubscribe");
  }
  return value;
}

function normalizeDrainLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_DRAIN_LIMIT;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_EVENT_BATCH
  ) {
    throw new HttpError(400, "invalid_drain_limit");
  }
  return value;
}

function normalizeEventIds(values: unknown[]): string[] {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new HttpError(400, "invalid_event_id");
    }
    if (!ids.includes(value)) {
      ids.push(value);
    }
  }
  return ids;
}

function wrapperRouteFromPath(
  pathname: string,
):
  | { kind: "page"; token: string }
  | { kind: "events"; token: string }
  | null {
  if (!pathname.startsWith("/w/")) {
    return null;
  }
  const parts = pathname.slice("/w/".length).split("/");
  const token = parts[0];
  if (token === undefined || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  if (parts.length === 1) {
    return { kind: "page", token };
  }
  if (parts.length === 2 && parts[1] === "events") {
    return { kind: "events", token };
  }
  return null;
}

function normalizeWrapperRegistration(value: unknown): WrapperRegistration {
  const keys = [
    "token",
    "target_url",
    "expires_at",
    "schema_version",
    "content_hash",
    "dwell_threshold_seconds",
    "content",
  ] as const;
  if (
    !isExactObject(value, keys) ||
    typeof value.token !== "string" ||
    typeof value.target_url !== "string" ||
    value.schema_version !== WRAPPER_SCHEMA_VERSION ||
    typeof value.content_hash !== "string" ||
    !CONTENT_HASH_PATTERN.test(value.content_hash) ||
    typeof value.dwell_threshold_seconds !== "number" ||
    !Number.isInteger(value.dwell_threshold_seconds) ||
    value.dwell_threshold_seconds < 5 ||
    value.dwell_threshold_seconds > 3600
  ) {
    throw new HttpError(400, "invalid_wrapper");
  }

  return {
    token: normalizeToken(value.token),
    targetUrl: normalizeWrapperTargetUrl(value.target_url),
    expiresAt: normalizeRequiredExpiry(value.expires_at),
    schemaVersion: WRAPPER_SCHEMA_VERSION,
    contentHash: value.content_hash,
    dwellThresholdSeconds: value.dwell_threshold_seconds,
    content: normalizeWrapperContent(value.content),
  };
}

function normalizeWrapperContent(value: unknown): WrapperContent {
  if (
    !isExactObject(value, [
      "listing_address",
      "property_intro",
      "ryan_note",
      "fact_sections",
      "hero",
    ])
  ) {
    throw new HttpError(400, "invalid_wrapper");
  }

  return {
    listing_address: normalizePlainText(value.listing_address, 1, 250),
    property_intro: normalizePlainText(value.property_intro, 1, 2000),
    ryan_note: normalizePlainText(value.ryan_note, 1, 2000),
    fact_sections: normalizeFactSections(value.fact_sections),
    hero: normalizeWrapperHero(value.hero),
  };
}

function normalizeFactSections(value: unknown): FactSection[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new HttpError(400, "invalid_wrapper");
  }
  return value.map((section) => {
    if (!isExactObject(section, ["label", "text"])) {
      throw new HttpError(400, "invalid_wrapper");
    }
    return {
      label: normalizePlainText(section.label, 1, 80),
      text: normalizePlainText(section.text, 1, 1000),
    };
  });
}

function normalizeWrapperHero(value: unknown): WrapperHero {
  if (
    !isStrictObject(value, ["kind", "title", "bars"]) ||
    !Object.hasOwn(value, "kind")
  ) {
    throw new HttpError(400, "invalid_wrapper");
  }

  const kind = value.kind;
  if (kind === "location_marker") {
    if (!isExactObject(value, ["kind"])) {
      throw new HttpError(400, "invalid_wrapper");
    }
    return { kind };
  }
  if (kind !== "comparison_chart") {
    throw new HttpError(400, "invalid_wrapper");
  }
  if (
    !isExactObject(value, ["kind", "title", "bars"]) ||
    !Array.isArray(value.bars) ||
    value.bars.length < 2 ||
    value.bars.length > 5
  ) {
    throw new HttpError(400, "invalid_wrapper");
  }

  return {
    kind,
    title: normalizePlainText(value.title, 1, 120),
    bars: value.bars.map((bar) => {
      if (
        !isExactObject(bar, ["label", "value"]) ||
        typeof bar.value !== "number" ||
        !Number.isFinite(bar.value) ||
        bar.value < 0 ||
        bar.value > 1_000_000_000
      ) {
        throw new HttpError(400, "invalid_wrapper");
      }
      return {
        label: normalizePlainText(bar.label, 1, 80),
        value: bar.value,
      };
    }),
  };
}

function normalizePlainText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string {
  const codePointLength =
    typeof value === "string" ? Array.from(value).length : 0;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    codePointLength < minimumLength ||
    codePointLength > maximumLength ||
    value.includes("<") ||
    value.includes(">") ||
    DISALLOWED_TEXT_CONTROL_PATTERN.test(value) ||
    EMAIL_VALUE_PATTERN.test(value) ||
    PHONE_VALUE_PATTERN.test(value) ||
    URL_VALUE_PATTERN.test(value) ||
    IMAGE_FILE_PATTERN.test(value) ||
    MARKDOWN_VALUE_PATTERN.test(value)
  ) {
    throw new HttpError(400, "invalid_wrapper");
  }
  return value;
}

function normalizeRequiredExpiry(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_expiry");
  }
  const normalized = normalizeExpiry(value);
  if (normalized === null || Date.parse(normalized) <= Date.now()) {
    throw new HttpError(400, "invalid_expiry");
  }
  return normalized;
}

function normalizeWrapperTargetUrl(value: string): string {
  const normalized = normalizeTargetUrl(value);
  const target = new URL(normalized);
  const hostname = target.hostname
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    target.hash !== "" ||
    (hostname !== ZILLOW_HOST && !hostname.endsWith(`.${ZILLOW_HOST}`))
  ) {
    throw new HttpError(400, "invalid_wrapper_target");
  }
  return normalized;
}

function normalizeWrapperEvent(
  value: unknown,
  dwellThresholdSeconds: number,
): NormalizedWrapperEvent {
  if (
    !isStrictObject(value, [
      "event_type",
      "client_event_id",
      "engagement_kind",
      "dwell_ms",
    ]) ||
    !Object.hasOwn(value, "event_type")
  ) {
    throw new HttpError(400, "invalid_wrapper_event");
  }

  if (value.event_type === "wrapper_viewed") {
    if (
      !isExactObject(value, ["event_type", "client_event_id"]) ||
      typeof value.client_event_id !== "string" ||
      !UUID_PATTERN.test(value.client_event_id)
    ) {
      throw new HttpError(400, "invalid_wrapper_event");
    }
    return {
      eventType: "wrapper_viewed",
      clientEventId: value.client_event_id.toLowerCase(),
      engagementKind: null,
      dwellMs: null,
    };
  }

  if (value.event_type !== "wrapper_engaged") {
    throw new HttpError(400, "invalid_wrapper_event");
  }
  if (
    typeof value.client_event_id !== "string" ||
    !UUID_PATTERN.test(value.client_event_id)
  ) {
    throw new HttpError(400, "invalid_wrapper_event");
  }

  if (value.engagement_kind === "cta") {
    if (
      !isExactObject(value, [
        "event_type",
        "client_event_id",
        "engagement_kind",
      ])
    ) {
      throw new HttpError(400, "invalid_wrapper_event");
    }
    return {
      eventType: "wrapper_engaged",
      clientEventId: value.client_event_id.toLowerCase(),
      engagementKind: "cta",
      dwellMs: null,
    };
  }

  if (
    value.engagement_kind !== "dwell" ||
    !isExactObject(value, [
      "event_type",
      "client_event_id",
      "engagement_kind",
      "dwell_ms",
    ]) ||
    typeof value.dwell_ms !== "number" ||
    !Number.isInteger(value.dwell_ms) ||
    value.dwell_ms < dwellThresholdSeconds * 1000 ||
    value.dwell_ms > MAX_DWELL_MS
  ) {
    throw new HttpError(400, "invalid_wrapper_event");
  }

  return {
    eventType: "wrapper_engaged",
    clientEventId: value.client_event_id.toLowerCase(),
    engagementKind: "dwell",
    dwellMs: value.dwell_ms,
  };
}

function renderWrapperPage(token: string, page: WrapperPageRow): string {
  const content = storedWrapperContent(page);
  const facts = content.fact_sections
    .map(
      (section) => `
          <section class="wrapper-fact">
            <h2>${escapeHtml(section.label)}</h2>
            <p>${escapeHtml(section.text)}</p>
          </section>`,
    )
    .join("");
  const thresholdMs = page.dwell_threshold_seconds * 1000;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(content.listing_address)} | Property brief</title>
    <link rel="stylesheet" href="/assets/wrapper.css">
    <script src="/assets/wrapper.js" defer></script>
  </head>
  <body>
    <header class="wrapper-masthead">
      <div class="wrapper-identity" aria-label="Ryan R. Gallop and Real">
        <div class="wrapper-identity-person">
          <img
            class="wrapper-identity-mark"
            src="/assets/logo-mark.svg"
            alt="Ryan R. Gallop constellation mark"
            width="48"
            height="48"
          >
          <strong>Ryan R. Gallop</strong>
          <span>Real Estate Agent</span>
        </div>
        <span class="wrapper-identity-divider" aria-hidden="true"></span>
        <div class="wrapper-identity-broker">
          <img
            src="/assets/real-logo-outline-white.svg"
            alt="Real"
            width="200"
            height="92"
          >
        </div>
      </div>
    </header>

    <main
      id="wrapper-page"
      class="wrapper-page"
      data-event-url="/w/${escapeHtml(token)}/events"
      data-dwell-threshold-ms="${thresholdMs}"
    >
      <article class="wrapper-sheet">
        <p class="wrapper-eyebrow">A private property brief</p>
        <h1>${escapeHtml(content.listing_address)}</h1>
        ${renderWrapperHero(content.hero)}

        <section class="wrapper-introduction" aria-labelledby="property-overview">
          <h2 id="property-overview">Property overview</h2>
          <p>${escapeHtml(content.property_intro)}</p>
        </section>

        ${
          facts.length > 0
            ? `<div class="wrapper-facts" aria-label="Property facts">${facts}
        </div>`
            : ""
        }

        <aside class="wrapper-note" aria-labelledby="ryan-note">
          <p class="wrapper-eyebrow">From Ryan</p>
          <h2 id="ryan-note">What I would keep in view</h2>
          <p>${escapeHtml(content.ryan_note)}</p>
        </aside>

        <a
          class="wrapper-cta"
          data-wrapper-cta
          href="${escapeHtml(page.target_url)}"
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
        >View full listing on Zillow →</a>
      </article>
    </main>

    <footer class="wrapper-footer">
      <p>Ryan R. Gallop · DRE #02403134 · Real Brokerage Technologies · California DRE #02022092</p>
    </footer>
  </body>
</html>`;
}

function storedWrapperContent(page: WrapperPageRow): WrapperContent {
  try {
    const factSections: unknown = JSON.parse(page.fact_sections_json);
    const hero: unknown = JSON.parse(page.hero_json);
    return normalizeWrapperContent({
      listing_address: page.listing_address,
      property_intro: page.property_intro,
      ryan_note: page.ryan_note,
      fact_sections: factSections,
      hero,
    });
  } catch {
    throw new Error("invalid_stored_wrapper_content");
  }
}

function renderWrapperHero(hero: WrapperHero): string {
  if (hero.kind === "location_marker") {
    return `
        <div
          class="wrapper-location-hero"
          role="img"
          aria-label="Decorative location marker"
        >
          <span aria-hidden="true"></span>
        </div>`;
  }

  const largestValue = Math.max(1, ...hero.bars.map((bar) => bar.value));
  const bars = hero.bars
    .map(
      (bar) => `
            <div class="wrapper-chart-row" role="listitem">
              <span class="wrapper-chart-label">${escapeHtml(bar.label)}</span>
              <meter
                min="0"
                max="${largestValue}"
                value="${bar.value}"
                aria-label="${escapeHtml(bar.label)}: ${escapeHtml(formatNumber(bar.value))}"
              >${escapeHtml(formatNumber(bar.value))}</meter>
              <span class="wrapper-chart-value">${escapeHtml(formatNumber(bar.value))}</span>
            </div>`,
    )
    .join("");

  return `
        <figure class="wrapper-chart-hero">
          <figcaption>${escapeHtml(hero.title)}</figcaption>
          <div class="wrapper-chart" role="list">${bars}
          </div>
        </figure>`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeTargetUrl(value: string): string {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value !== value.trim() ||
    RAW_URL_WHITESPACE_OR_CONTROL_PATTERN.test(value)
  ) {
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
    (
      target.pathname === "/l" ||
      target.pathname.startsWith("/l/") ||
      target.pathname === "/w" ||
      target.pathname.startsWith("/w/")
    )
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
      const aliasRoute = routeName(url.pathname);
      return aliasRoute === "public_link" ||
        aliasRoute === "public_unsubscribe" ||
        aliasRoute === "public_wrapper"
        ? finalizeResponse(redirect, aliasRoute)
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
      if (route === "public_unsubscribe") {
        return finalizeResponse(
          await handlePublicUnsubscribe(request, env, url.pathname),
          route,
        );
      }
      if (route === "public_wrapper") {
        return finalizeResponse(
          await handlePublicWrapper(request, env, url.pathname),
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
