import { NextResponse } from "next/server";
import { getEnv, resolveMessagingProvider } from "@/lib/env";
import { inboundFromTelegram, type TelegramUpdate } from "@/lib/messaging/telegram-webhook";
import { TelegramMessagingProvider } from "@/lib/messaging/telegram-provider";
import { processMessage, processMessageWithProvider } from "@/lib/runtime";
import { constantTimeEqual } from "@/lib/messaging/verify-signature";

/** See the note in /api/simulate: a live search needs longer than the default. */
export const maxDuration = 60;

/** Constant-time compare that tolerates unequal lengths. */
export async function POST(request: Request) {
  const env = getEnv();

  // A webhook route serves its own transport whenever that transport is
  // configured, rather than only when MESSAGING_PROVIDER names it. The route
  // *is* the transport signal — a delivery arriving here came from Telegram —
  // and gating on a single global selector makes one deployment able to answer
  // only one chat platform. Replies go back through the provider built here,
  // never the shared singleton, so a Telegram message cannot be answered over
  // Discord.
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Telegram webhook is not configured." },
      { status: 503 },
    );
  }

  // Telegram authenticates itself with the secret_token supplied at setWebhook
  // time, echoed back on every delivery in this header.
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(presented, env.TELEGRAM_WEBHOOK_SECRET)) {
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

  // Mock stays honest in local runs: with MESSAGING_PROVIDER=mock nothing is
  // sent to a real account, which is what keeps the simulator unable to spend.
  const isMock = resolveMessagingProvider(env) === "mock";

  // Without a bot token there is no way to answer over Telegram. Refusing is
  // the only safe option — falling through to whatever transport is configured
  // would answer a Telegram conversation over Linq or Discord, which is the
  // cross-transport leak this route has to prevent.
  if (!isMock && !env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ accepted: true, processed: false }, { status: 202 });
  }

  const result = isMock
    ? await processMessage(inbound)
    : await processMessageWithProvider(inbound, new TelegramMessagingProvider());

  return NextResponse.json(
    { accepted: true, processed: result.processed },
    { status: 202 },
  );
}
