import LinqAPIV3 from "@linqapp/sdk";
import { NextResponse } from "next/server";
import { getEnv, resolveMessagingProvider } from "@/lib/env";
import { inboundFromLinq } from "@/lib/messaging/linq-webhook";
import { processMessage } from "@/lib/runtime";

/** See the note in /api/simulate: a live search needs longer than the default. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const env = getEnv();
  const provider = resolveMessagingProvider(env);
  if (provider !== "mock" && provider !== "linq") {
    return NextResponse.json({ accepted: true, processed: false }, { status: 202 });
  }

  if (!env.LINQ_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Linq webhook is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event: LinqAPIV3.UnwrapWebhookEvent;
  try {
    const client = new LinqAPIV3({
      apiKey: env.LINQ_API_KEY ?? "webhook-verification-only",
      webhookSecret: env.LINQ_WEBHOOK_SECRET,
    });
    event = client.webhooks.unwrap(rawBody, { headers });
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const inbound = inboundFromLinq(event);
  if (!inbound) {
    return NextResponse.json({ accepted: true, processed: false }, { status: 202 });
  }

  const result = await processMessage(inbound);
  return NextResponse.json(
    { accepted: true, processed: result.processed },
    { status: 202 },
  );
}
