import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENAI_URL,
  RelayTargetError,
  isAllowedHost,
  resolveAzureUrl,
  resolveOpenAiUrl,
} from './relayTargets';

describe('resolveOpenAiUrl', () => {
  it('defaults to api.openai.com when the caller sends no baseUrl', () => {
    expect(resolveOpenAiUrl(undefined)).toBe(DEFAULT_OPENAI_URL);
    expect(resolveOpenAiUrl('')).toBe(DEFAULT_OPENAI_URL);
  });

  it('accepts the OpenAI-wire-format providers the relay documents supporting', () => {
    expect(resolveOpenAiUrl('https://api.groq.com/openai/v1/chat/completions')).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(resolveOpenAiUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  // Each of these is a way to reach something that is not a model provider
  // from inside a Vercel function. They are the reason the allowlist exists,
  // so they are asserted individually rather than as one loop -- a failure
  // should name which vector got through.
  it('rejects cloud instance metadata', () => {
    expect(() => resolveOpenAiUrl('https://169.254.169.254/latest/meta-data/')).toThrow(RelayTargetError);
  });

  it('rejects loopback and private address space', () => {
    expect(() => resolveOpenAiUrl('https://127.0.0.1/v1/chat/completions')).toThrow(RelayTargetError);
    expect(() => resolveOpenAiUrl('https://localhost/v1/chat/completions')).toThrow(RelayTargetError);
    expect(() => resolveOpenAiUrl('https://10.0.0.5/v1/chat/completions')).toThrow(RelayTargetError);
    expect(() => resolveOpenAiUrl('https://[::1]/v1/chat/completions')).toThrow(RelayTargetError);
  });

  it('rejects arbitrary third-party hosts', () => {
    expect(() => resolveOpenAiUrl('https://attacker.example/collect')).toThrow(RelayTargetError);
  });

  it('rejects non-https schemes, including the non-network ones', () => {
    expect(() => resolveOpenAiUrl('http://api.openai.com/v1/chat/completions')).toThrow(/must use https/);
    expect(() => resolveOpenAiUrl('file:///etc/passwd')).toThrow(RelayTargetError);
    expect(() => resolveOpenAiUrl('data:text/plain,hello')).toThrow(RelayTargetError);
  });

  it('rejects a lookalike host that merely ends with an allowed name', () => {
    expect(() => resolveOpenAiUrl('https://api.openai.com.attacker.example/v1')).toThrow(RelayTargetError);
    expect(() => resolveOpenAiUrl('https://notapi.openai.com/v1')).toThrow(RelayTargetError);
  });

  it('rejects an allowed host reached via userinfo pointing somewhere else', () => {
    // https://api.openai.com@attacker.example/ parses with hostname
    // "attacker.example" -- the allowlist sees the real host, not the decoy.
    expect(() => resolveOpenAiUrl('https://api.openai.com@attacker.example/v1')).toThrow(RelayTargetError);
  });

  it('rejects credentials embedded in an otherwise allowed URL', () => {
    expect(() => resolveOpenAiUrl('https://user:pass@api.openai.com/v1')).toThrow(/must not carry credentials/);
  });

  it('rejects a malformed URL rather than falling back to the default', () => {
    expect(() => resolveOpenAiUrl('not a url')).toThrow(/not a valid absolute URL/);
    expect(() => resolveOpenAiUrl('/v1/chat/completions')).toThrow(/not a valid absolute URL/);
  });
});

describe('isAllowedHost', () => {
  it('matches Azure per-tenant subdomains but not the bare suffix owner', () => {
    expect(isAllowedHost('my-resource.openai.azure.com')).toBe(true);
    expect(isAllowedHost('MY-RESOURCE.OpenAI.Azure.Com')).toBe(true);
    expect(isAllowedHost('evil-openai.azure.com')).toBe(false);
    expect(isAllowedHost('azure.com')).toBe(false);
  });
});

describe('resolveAzureUrl', () => {
  it('builds the deployment path and api-version from an allowed endpoint', () => {
    const url = resolveAzureUrl('https://my-resource.openai.azure.com', 'gpt-4o', undefined);
    expect(url).toBe(
      'https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('honours an explicit api version', () => {
    const url = resolveAzureUrl('https://my-resource.openai.azure.com', 'gpt-4o', '2025-01-01');
    expect(url).toContain('api-version=2025-01-01');
  });

  it('discards any path, query or fragment the caller attached to the endpoint', () => {
    const url = resolveAzureUrl('https://my-resource.openai.azure.com/some/path?x=1#frag', 'gpt-4o', undefined);
    expect(url).toBe(
      'https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('cannot be walked out of the deployments path by a crafted deployment name', () => {
    const url = resolveAzureUrl('https://my-resource.openai.azure.com', '../../evil', undefined);
    expect(new URL(url).pathname).toBe('/openai/deployments/..%2F..%2Fevil/chat/completions');
  });

  it('rejects an endpoint outside the allowlist', () => {
    expect(() => resolveAzureUrl('https://attacker.example', 'gpt-4o', undefined)).toThrow(RelayTargetError);
  });

  it('requires both endpoint and deployment', () => {
    expect(() => resolveAzureUrl(undefined, 'gpt-4o', undefined)).toThrow(/required for the Azure provider/);
    expect(() => resolveAzureUrl('https://my-resource.openai.azure.com', undefined, undefined)).toThrow(
      /required for the Azure provider/,
    );
  });
});
