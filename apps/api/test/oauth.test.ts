import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { hash, redirectAllowed, s256, type OAuthClient } from '../src/lib/oauth.ts';

const client = (uris: string[]): OAuthClient => ({
  id: 'c1',
  clientName: 'Test',
  redirectUris: uris,
});

describe('PKCE', () => {
  it('computes the S256 challenge RFC 7636 specifies', () => {
    // The worked example from RFC 7636 appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    assert.equal(s256(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is base64url, so it survives a query string intact', () => {
    for (let i = 0; i < 50; i++) {
      const challenge = s256(randomBytes(32).toString('base64url'));
      assert.match(challenge, /^[A-Za-z0-9_-]+$/);
      assert.ok(!challenge.includes('='));
    }
  });

  it('separates verifiers that differ by one character', () => {
    assert.notEqual(s256('verifier-a'), s256('verifier-b'));
  });
});

describe('token hashing', () => {
  it('stores a digest, never the token', () => {
    const token = randomBytes(32).toString('base64url');
    assert.equal(hash(token), createHash('sha256').update(token).digest('hex'));
    assert.ok(!hash(token).includes(token));
  });

  it('is deterministic, because lookup is by exact hash', () => {
    const token = randomBytes(32).toString('base64url');
    assert.equal(hash(token), hash(token));
  });
});

describe('redirect_uri matching', () => {
  const hosted = client(['https://claude.ai/api/mcp/auth_callback']);

  it('accepts the exact registered URI', () => {
    assert.ok(redirectAllowed(hosted, 'https://claude.ai/api/mcp/auth_callback'));
  });

  it('rejects anything else, which is what stops an open redirect', () => {
    for (const bad of [
      'https://evil.example/cb',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback/../../steal',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
      'http://claude.ai/api/mcp/auth_callback',
      'not a url',
      '',
    ]) {
      assert.ok(!redirectAllowed(hosted, bad), `${bad} should be rejected`);
    }
  });

  it('ignores the port on loopback, which native clients need', () => {
    // Claude Code listens on an ephemeral port, so RFC 8252 section 7.3 says
    // the port cannot be part of the comparison.
    const native = client(['http://localhost/callback', 'http://127.0.0.1/callback']);
    assert.ok(redirectAllowed(native, 'http://localhost:3118/callback'));
    assert.ok(redirectAllowed(native, 'http://127.0.0.1:52341/callback'));
    assert.ok(redirectAllowed(native, 'http://localhost/callback'));
  });

  it('does not let the loopback exception widen anything else', () => {
    const native = client(['http://localhost/callback']);
    // A different path is still a different redirect.
    assert.ok(!redirectAllowed(native, 'http://localhost:3118/elsewhere'));
    // A different scheme is not the same client.
    assert.ok(!redirectAllowed(native, 'https://localhost:3118/callback'));
    // And a hostname that merely contains "localhost" is not loopback.
    assert.ok(!redirectAllowed(native, 'http://localhost.evil.example/callback'));
    // A hosted client does not get loopback redirects thrown in.
    assert.ok(!redirectAllowed(hosted, 'http://localhost:3118/callback'));
  });
});
