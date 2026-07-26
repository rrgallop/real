const CANONICAL_HOST = "homes.ryangallop.com";
const REDIRECT_HOSTS = new Set([
  "reinventingrealty.co",
  "www.reinventingrealty.co",
  "ryangallop.com",
  "www.ryangallop.com",
  "rgallop.com",
  "www.rgallop.com",
]);

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

export default {
  async fetch(request, env): Promise<Response> {
    const host = new URL(request.url).hostname.toLowerCase();

    if (REDIRECT_HOSTS.has(host)) {
      return redirectToCanonical(request);
    }

    const response = await env.ASSETS.fetch(request);
    return addSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
