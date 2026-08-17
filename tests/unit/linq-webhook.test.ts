import type LinqAPIV3 from "@linqapp/sdk";
import { describe, expect, it } from "vitest";
import { inboundFromLinq } from "@/lib/messaging/linq-webhook";

function receivedEvent(
  overrides: Record<string, unknown> = {},
): LinqAPIV3.UnwrapWebhookEvent {
  return {
    api_version: "v3",
    created_at: "2026-02-05T19:31:13.736Z",
    event_id: "event-1",
    event_type: "message.received",
    partner_id: "partner-1",
    trace_id: "trace-1",
    webhook_version: "2026-02-03",
    data: {
      id: "message-1",
      chat: {
        id: "chat-1",
        is_group: true,
        health_status: {
          status: "HEALTHY",
          reasons: [],
          doc_url: "https://docs.linqapp.com",
        },
      },
      direction: "inbound",
      parts: [
        { type: "text", value: "pick a place" },
        { type: "text", value: "near downtown" },
      ],
      sender_handle: {
        id: "handle-1",
        handle: "+15555550100",
        joined_at: "2026-02-01T00:00:00Z",
        service: "iMessage",
      },
      service: "iMessage",
    },
    ...overrides,
  } as unknown as LinqAPIV3.UnwrapWebhookEvent;
}

describe("inboundFromLinq", () => {
  it("normalizes a signed SDK message event for the conversation service", () => {
    expect(inboundFromLinq(receivedEvent())).toEqual({
      eventId: "event-1",
      linqChatId: "chat-1",
      isGroup: true,
      senderHandle: "+15555550100",
      text: "pick a place\nnear downtown",
      wasInvoked: false,
    });
  });

  it("ignores unrelated and unpinned events", () => {
    expect(
      inboundFromLinq(receivedEvent({ event_type: "message.delivered" })),
    ).toBeNull();
    expect(
      inboundFromLinq(receivedEvent({ webhook_version: "2025-01-01" })),
    ).toBeNull();
  });
});
