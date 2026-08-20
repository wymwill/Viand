import type { InboundMessage } from "../conversation/service";

/** The slice of Slack's Events API payload this app consumes. */
export interface SlackEnvelope {
  readonly type?: string;
  /** Present only on the one-off URL verification handshake. */
  readonly challenge?: string;
  /** Stable per delivery; Slack retries reuse it. */
  readonly event_id?: string;
  readonly event?: {
    readonly type?: string;
    readonly subtype?: string;
    readonly text?: string;
    readonly channel?: string;
    readonly channel_type?: string;
    readonly user?: string;
    readonly ts?: string;
    /** Set when the message came from a bot, including this one. */
    readonly bot_id?: string;
  };
}

/**
 * Strips Slack's mention syntax and reports whether Viand was addressed.
 *
 * Slack renders a mention as `<@U0ABC>` rather than the display name, so the
 * bot's own user id is what has to be matched — the name a workspace gives the
 * app is editable and would not survive a rename.
 */
export function normaliseSlackText(
  text: string,
  botUserId?: string,
): { text: string; wasInvoked: boolean } {
  let result = text.trim();
  let wasInvoked = false;

  if (botUserId) {
    const mention = new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, "g");
    wasInvoked = mention.test(result);
    result = result.replace(mention, " ");
  }

  // Any remaining mention belongs to somebody else and is not ours to read.
  result = result.replace(/<@[UW][A-Z0-9]+(?:\|[^>]*)?>/g, " ");
  // Slack wraps links as <url|label> or <url>; keep what a human would read.
  result = result.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2").replace(/<(https?:[^>]+)>/g, "$1");

  return { text: result.replace(/\s+/g, " ").trim(), wasInvoked };
}

/**
 * Converts a Slack event into the shape every transport shares.
 *
 * Anything that is not a plain human message is acknowledged and ignored:
 * edits and deletions carry a `subtype`, and anything with a `bot_id` is a bot
 * speaking — including Viand itself, which would otherwise answer its own
 * replies forever.
 */
export function inboundFromSlack(
  envelope: SlackEnvelope,
  botUserId?: string,
): InboundMessage | null {
  if (envelope.type !== "event_callback" || !envelope.event_id) return null;

  const event = envelope.event;
  if (!event || event.type !== "message" || event.subtype || event.bot_id) return null;
  if (!event.channel || !event.user) return null;

  const { text, wasInvoked } = normaliseSlackText(event.text ?? "", botUserId);
  if (!text && !wasInvoked) return null;

  return {
    // Slack reuses event_id across its retries, so it feeds the same
    // idempotency gate as Telegram's update_id.
    eventId: `slack:${envelope.event_id}`,
    linqChatId: event.channel,
    // A direct message channel starts with D; everything else is shared.
    isGroup: !event.channel.startsWith("D"),
    senderHandle: `slack:${event.user}`,
    text,
    wasInvoked,
  };
}
