import { createHmac, timingSafeEqual } from 'node:crypto';

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createProfileToken({ organisationId, organisationName, secret, ttlSeconds, version }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(
    JSON.stringify({
      sub: organisationId,
      name: organisationName,
      iat: now,
      exp: now + ttlSeconds,
      ...(version !== undefined && version !== null ? { v: Number(version) } : {}),
    }),
  );
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyProfileToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;

  const expected = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Revocation check: an edit link is only valid while its embedded token
 * version (missing in old tokens = 1) matches the organisation's current
 * token_version. Bump organisations.token_version to kill every link.
 */
export function tokenMatchesOrganisation(payload, organisation) {
  if (!payload || !organisation) return false;
  const tokenVersion = Number.isInteger(payload.v) ? payload.v : 1;
  const current = Number.isInteger(organisation.token_version)
    ? organisation.token_version
    : 1;
  return tokenVersion === current;
}
