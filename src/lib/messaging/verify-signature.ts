import { createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Constant-time equality for authentication material of equal public length. */
export function constantTimeEqual(received: string | Buffer, expected: string | Buffer): boolean {
  const a = Buffer.isBuffer(received) ? received : Buffer.from(received);
  const b = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
