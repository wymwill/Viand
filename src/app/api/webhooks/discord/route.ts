import { after, NextResponse } from "next/server";
import * as copy from "@/domain/messages/copy";
import { getEnv, resolveMessagingProvider } from "@/lib/env";
import { chatRef, logDegradation } from "@/lib/observability/log";
import { DiscordMessagingProvider } from "@/lib/messaging/discord-provider";
import { inboundFromDiscord, type DiscordInteraction } from "@/lib/messaging/discord-webhook";
import { verifyDiscordSignature } from "@/lib/messaging/verify-signature";
import { processMessageWithProvider } from "@/lib/runtime";

export const maxDuration = 60;

/** Interaction response types. 1 answers the registration PING. */
const PONG = 1;
/** "Viand is thinking…" — buys up to fifteen minutes to send the real reply. */
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;

export async function POST(request: Request) {
  const env = getEnv();
  // Served whenever Discord is configured, not only when MESSAGING_PROVIDER
  // names it — see the note in the Telegram route. This route already builds
  // its own per-interaction provider, so replies cannot cross transports.
  if (!env.DISCORD_PUBLIC_KEY) {
    return NextResponse.json({ error: "Discord webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const signatureHex = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  if (!verifyDiscordSignature({ publicKeyHex: env.DISCORD_PUBLIC_KEY, signatureHex, timestamp, rawBody })) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return NextResponse.json({ error: "Malformed interaction." }, { status: 400 });
  }
  if (interaction.type === PONG) return NextResponse.json({ type: PONG });

  const inbound = inboundFromDiscord(interaction);
  const token = interaction.token;
  if (!inbound || !token) {
    return NextResponse.json({ error: "Unsupported interaction." }, { status: 400 });
  }

  // Discord discards an interaction that is not acknowledged within three
  // seconds, and a live restaurant search regularly takes longer than that —
  // which is why this route allows sixty. So acknowledge first with a deferral
  // (type 5, "Viand is thinking…") and run the decision afterwards, replying
  // over the followup webhook. Doing the work before responding would time the
  // interaction out on exactly the searches that matter most.
  after(async () => {
    // Constructed inside the try: a throw here used to escape the handler
    // below, leaving the deferred "thinking…" placeholder to sit forever with
    // no way to edit it.
    let provider: DiscordMessagingProvider | null = null;
    try {
      provider = new DiscordMessagingProvider(token);
      await processMessageWithProvider(inbound, provider);
    } catch (error) {
      logDegradation(
        "interaction_failed",
        { transport: "discord", chat: chatRef(inbound.linqChatId) },
        error,
      );
      // The placeholder would otherwise sit as "thinking…" forever; the group
      // is told the attempt failed rather than left waiting on nothing. If the
      // provider itself could not be built there is nothing to answer with.
      await (provider ?? new DiscordMessagingProvider(token))
        .sendMessage({ chatId: inbound.linqChatId, text: copy.REQUEST_FAILED })
        .catch((sendError: unknown) =>
          logDegradation(
            "reply_delivery_failed",
            { transport: "discord", chat: chatRef(inbound.linqChatId) },
            sendError,
          ),
        );
    }
  });

  return NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
}
