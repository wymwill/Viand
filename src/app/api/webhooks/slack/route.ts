import { NextResponse } from "next/server";
import { getEnv, resolveMessagingProvider } from "@/lib/env";
import { inboundFromSlack, type SlackEnvelope } from "@/lib/messaging/slack-webhook";
import { SlackMessagingProvider } from "@/lib/messaging/slack-provider";
import { verifySlackSignature } from "@/lib/messaging/verify-signature";
import { processMessage, processMessageWithProvider } from "@/lib/runtime";

/** See the note in /api/simulate: a live search needs longer than the default. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const env = getEnv();

  // Served whenever Slack is configured, not only when MESSAGING_PROVIDER
  // names it — the route is the transport signal, and one deployment should be
  // able to answer every platform it has credentials for.
  if (!env.SLACK_SIGNING_SECRET) {
    return NextResponse.json({ error: "Slack webhook is not configured." }, { status: 503 });
  }

  // Read the body as text and verify it before parsing. Slack signs the exact
  // bytes it sent, so parsing first and re-serialising would verify something
  // Slack never signed.
  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature") ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";

  if (
    !verifySlackSignature({
      signingSecret: env.SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      rawBody,
    })
  ) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let envelope: SlackEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });
  }

  // The one-off handshake Slack performs when the endpoint URL is saved.
  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge ?? "" });
  }

  const inbound = inboundFromSlack(envelope, env.SLACK_BOT_USER_ID);
  if (!inbound) {
    return NextResponse.json({ accepted: true, processed: false }, { status: 200 });
  }

  const isMock = resolveMessagingProvider(env) === "mock";

  // Without a bot token there is no way to answer over Slack. Refusing beats
  // falling through to whatever transport is configured, which would reply to
  // a Slack conversation somewhere else entirely.
  if (!isMock && !env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ accepted: true, processed: false }, { status: 200 });
  }

  const result = isMock
    ? await processMessage(inbound)
    : await processMessageWithProvider(inbound, new SlackMessagingProvider());

  // Slack retries anything that is not a prompt 2xx, so acknowledge the
  // delivery itself rather than the outcome of handling it.
  return NextResponse.json({ accepted: true, processed: result.processed }, { status: 200 });
}
