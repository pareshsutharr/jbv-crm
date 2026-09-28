import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32-byte key from TOKEN_ENCRYPTION_KEY (preferred) or derived from NEXTAUTH_SECRET. */
function key() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY or NEXTAUTH_SECRET must be set");
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

/** decrypt() that returns null instead of throwing (e.g. a value written under a different TOKEN_ENCRYPTION_KEY). */
export function tryDecrypt(token: string | null | undefined) {
  if (!token) return null;
  try {
    return decrypt(token);
  } catch {
    return null;
  }
}

export function decrypt(token: string) {
  const buf = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Signed, expiring state for OAuth redirects. */
export function signState(payload: Record<string, unknown>, ttlSeconds = 600) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string | null): T | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key()).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  return data.exp > Date.now() / 1000 ? data : null;
}
