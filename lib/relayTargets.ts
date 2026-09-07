// Endpoint allowlist for api/agent-relay.ts.
//
// The relay forwards a caller-supplied URL with a caller-supplied credential
// and streams the response body back with `Access-Control-Allow-Origin: *`.
// Without a check on the destination that is a general-purpose SSRF proxy
// wearing this deployment's IP: anything reachable from a Vercel function —
// cloud metadata, an internal service, an arbitrary third-party host — could
// be fetched and read by any anonymous caller.
//
// So the destination is validated against a fixed set of hosts rather than
// sanitised. Sanitising is the wrong shape of defence here: DNS names can
// resolve to private space, redirects can leave the allowlist, and IPv6 and
// IPv4-mapped forms multiply the encodings a blocklist has to catch. An
// allowlist of "the OpenAI-wire-format providers this app supports" has none
// of those failure modes, and it is the whole set the feature ever needed —
// see the provider list in api/agent-relay.ts's own header comment.

/** Exact hostnames, plus suffixes for providers that give every tenant its own
 *  subdomain. A suffix entry must start with a dot so `evil-openai.azure.com`
 *  can never satisfy `.openai.azure.com`. */
const ALLOWED_HOSTS: readonly string[] = [
  "api.openai.com",
  "api.groq.com",
  "api.anthropic.com",
  "api.mistral.ai",
  "api.together.xyz",
  "api.deepseek.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
];

const ALLOWED_HOST_SUFFIXES: readonly string[] = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
];

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export class RelayTargetError extends Error {}

/** Parses and allowlists one relay destination.
 *
 *  Throws RelayTargetError with a message safe to show the caller — it names
 *  only what they sent, never anything about this deployment. */
function checkedUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayTargetError(`${label} is not a valid absolute URL`);
  }
  // http:// would let a MITM read the caller's key in transit, and the
  // non-network schemes (file:, data:, blob:) are the classic SSRF pivots.
  if (url.protocol !== "https:") {
    throw new RelayTargetError(`${label} must use https`);
  }
  if (url.username || url.password) {
    throw new RelayTargetError(`${label} must not carry credentials`);
  }
  if (!isAllowedHost(url.hostname)) {
    throw new RelayTargetError(
      `${label} host "${url.hostname}" is not an allowed model provider. ` +
        `Allowed: ${[...ALLOWED_HOSTS, ...ALLOWED_HOST_SUFFIXES.map((s) => `*${s}`)].join(", ")}`,
    );
  }
  return url;
}

export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_AZURE_API_VERSION = "2024-12-01-preview";

/** Resolves the OpenAI-compatible chat-completions URL for a `baseUrl`,
 *  falling back to api.openai.com when the caller sent none. */
export function resolveOpenAiUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return DEFAULT_OPENAI_URL;
  return checkedUrl(baseUrl, "baseUrl").toString();
}

/** Builds the Azure deployment URL. The deployment name lands in a path
 *  segment, so it is encoded rather than interpolated raw — otherwise a name
 *  containing `../` could walk out of /openai/deployments/ and reach another
 *  path on the (allowlisted, but still not arbitrary) Azure host. */
export function resolveAzureUrl(
  azureEndpoint: string | undefined,
  azureDeployment: string | undefined,
  azureApiVersion: string | undefined,
): string {
  if (!azureEndpoint || !azureDeployment) {
    throw new RelayTargetError("azureEndpoint and azureDeployment are required for the Azure provider");
  }
  const base = checkedUrl(azureEndpoint, "azureEndpoint");
  // Only the origin is taken from the caller's endpoint — any path, query or
  // fragment they attached is discarded, so the request always lands on the
  // real chat-completions route.
  const version = azureApiVersion || DEFAULT_AZURE_API_VERSION;
  const url = new URL(
    `/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions`,
    base.origin,
  );
  url.searchParams.set("api-version", version);
  return url.toString();
}
