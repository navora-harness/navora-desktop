import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expect] = parts
  const actual = scryptSync(password, salt, 32).toString('hex')
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expect, 'hex'))
  } catch {
    return false
  }
}

/** Remote login token TTL: 3 days */
export const WEB_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000

export interface WebTokenPayload {
  u: string
  iat: number
  exp: number
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

export function createWebToken(
  username: string,
  passwordHash: string,
  ttlMs = WEB_TOKEN_TTL_MS,
): { token: string; exp: number; iat: number } {
  const iat = Date.now()
  const exp = iat + ttlMs
  const payload = b64url(Buffer.from(JSON.stringify({ u: username, iat, exp } as WebTokenPayload)))
  const sig = b64url(createHmac('sha256', passwordHash).update(`nv1.${payload}`).digest())
  return { token: `nv1.${payload}.${sig}`, exp, iat }
}

export function verifyWebToken(
  token: string,
  username: string,
  passwordHash: string,
): WebTokenPayload | null {
  if (!token || !passwordHash || !username) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'nv1') return null
  const [, payload, sig] = parts
  const expect = b64url(createHmac('sha256', passwordHash).update(`nv1.${payload}`).digest())
  try {
    if (expect.length !== sig.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) {
      return null
    }
  } catch {
    return null
  }
  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8')) as WebTokenPayload
    if (data.u !== username) return null
    if (!Number.isFinite(data.exp) || data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}
