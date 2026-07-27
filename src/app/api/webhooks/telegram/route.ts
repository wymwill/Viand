import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { inboundFromTelegram, type TelegramUpdate } from "@/lib/messaging/telegram-webhook";
import { processMessage } from "@/lib/runtime";

/** See the note in /api/simulate: a live search needs longer than the default. */
export const maxDuration = 30;

/** Constant-time compare that tolerates unequal lengths. */
function secretMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so screen for it first. The
  // length of a secret is not itself sensitive.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const env = getEnv();
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Telegram webhook is not configured." },
      { status: 503 },
    );
  }

  // Telegram authenticates itself with the secret_token supplied at setWebhook
  // time, echoed back on every delivery in this header.
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secretMatches(presented, env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid secret token." }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Malformed update." }, { status: 400 });
  }

  const inbound = inboundFromTelegram(update, env.TELEGRAM_BOT_USERNAME);
  if (!inbound) {
    return NextResponse.json({ accepted: true, processed: false }, { status: 202 });
  }

  const result = await processMessage(inbound);
  return NextResponse.json(
    { accepted: true, processed: result.processed },
    { status: 202 },
  );
}
