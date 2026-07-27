import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export type ViandNumber = {
  /** Human-readable form, e.g. "(555) 555-0123". */
  display: string;
  /** Dialable form used for sms: links, e.g. "+15555550123". */
  e164: string;
};

const FALLBACK: ViandNumber = { display: "(555) 555-0123", e164: "+15555550123" };

/** Renders +1XXXXXXXXXX as (XXX) XXX-XXXX; anything else is shown as-is. */
function toDisplay(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/**
 * The number people actually text. Prefers the provisioned line when one is
 * live, and otherwise serves the published number from configuration.
 */
export async function GET() {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return NextResponse.json<ViandNumber>(FALLBACK);
  }

  const provisioned = env.USE_MOCK_LINQ ? undefined : env.LINQ_PHONE_NUMBER;
  if (provisioned) {
    return NextResponse.json<ViandNumber>({
      display: toDisplay(provisioned),
      e164: provisioned,
    });
  }

  return NextResponse.json<ViandNumber>({
    display: env.PHONE_NUMBER_DISPLAY,
    e164: env.PHONE_NUMBER_E164,
  });
}
