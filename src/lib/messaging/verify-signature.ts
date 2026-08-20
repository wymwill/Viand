import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Constant-time equality for authentication material of equal public length. */
export function constantTimeEqual(received: string | Buffer, expected: string | Buffer): boolean {
  const a = Buffer.isBuffer(received) ? received : Buffer.from(received);
  const b = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Slack signs `v0:{timestamp}:{body}` with the app's signing secret.
 *
 * The timestamp is inside the signed string *and* checked for freshness: a
 * signature stays valid forever otherwise, so a captured request could be
 * replayed indefinitely. Five minutes is Slack's own guidance.
 */
export function verifySlackSignature(input: {
  readonly signingSecret: string;
  readonly signature: string;
  readonly timestamp: string;
  readonly rawBody: string;
  readonly now?: Date;
}): boolean {
  const seconds = Number(input.timestamp);
  if (!Number.isFinite(seconds)) return false;

  const nowSeconds = (input.now?.getTime() ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - seconds) > 60 * 5) return false;

  const expected =
    "v0=" +
    createHmac("sha256", input.signingSecret)
      .update(`v0:${input.timestamp}:${input.rawBody}`)
      .digest("hex");

  return constantTimeEqual(input.signature, expected);
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(input: {
  readonly publicKeyHex: string;
  readonly signatureHex: string;
  readonly timestamp: string;
  readonly rawBody: string;
}): boolean {
  try {
    const rawKey = Buffer.from(input.publicKeyHex, "hex");
    const signature = Buffer.from(input.signatureHex, "hex");
    if (rawKey.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(input.timestamp + input.rawBody, "utf8"),
      key,
      signature,
    );
  } catch {
    return false;
  }
}
