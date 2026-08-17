import type LinqAPIV3 from "@linqapp/sdk";
import type { InboundMessage } from "../conversation/service";
import { normalisePlainMention } from "./mention";

/**
 * Converts the SDK's pinned 2026-02-03 event into the small internal message
 * shape consumed by the conversation service. Non-message events and messages
 * without text are acknowledged but ignored.
 */
export function inboundFromLinq(
  event: LinqAPIV3.UnwrapWebhookEvent,
): InboundMessage | null {
  if (event.event_type !== "message.received") return null;

  const received = event as LinqAPIV3.MessageReceivedWebhookEvent;
  if (received.webhook_version !== "2026-02-03") return null;
  if (received.data.direction !== "inbound") return null;

  const rawText = received.data.parts
    .filter(
      (part): part is LinqAPIV3.SchemasTextPartResponse =>
        part.type === "text",
    )
    .map((part) => part.value)
    .join("\n")
    .trim();

  if (!rawText) return null;
  const { text, wasInvoked } = normalisePlainMention(rawText);
  if (!text && !wasInvoked) return null;

  return {
    eventId: received.event_id,
    linqChatId: received.data.chat.id,
    isGroup: received.data.chat.is_group === true,
    senderHandle: received.data.sender_handle.handle,
    text,
    wasInvoked,
  };
}
