import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { processMessage } from "@/lib/runtime";

const simulationSchema = z.object({
  chatId: z.string().min(1).max(100).default("demo-group"),
  sender: z.string().min(1).max(100).default("you"),
  text: z.string().trim().min(1).max(2_000),
});

export async function POST(request: Request) {
  const parsed = simulationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send a non-empty text message." },
      { status: 400 },
    );
  }

  const result = await processMessage({
    eventId: randomUUID(),
    linqChatId: parsed.data.chatId,
    isGroup: true,
    senderHandle: parsed.data.sender,
    text: parsed.data.text,
  });

  return NextResponse.json(result);
}
