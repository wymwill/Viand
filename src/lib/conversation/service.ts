import { advance } from "@/domain/state-machine/engine";
import { initialSnapshot } from "@/domain/state-machine/session";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { parseCommand } from "@/domain/commands";
import * as copy from "@/domain/messages/copy";
import { ONBOARDING } from "@/domain/messages/copy";
import type { MessagingProvider } from "../messaging/provider";
import type { SessionStore, StoredChat } from "../store/types";

/** One inbound message, normalised from a webhook or the simulator. */
export interface InboundMessage {
  /** Deduplication key. In production this is the Linq event id. */
  eventId: string;
  linqChatId: string;
  isGroup: boolean;
  /** The sender's Linq handle (E.164 or email). Stable member identity. */
  senderHandle: string;
  text: string;
}

export interface ConversationDeps {
  store: SessionStore;
  messaging: MessagingProvider;
  restaurants: RestaurantProvider;
}

export interface HandleResult {
  /** False when the event was a duplicate and processing was skipped. */
  processed: boolean;
  replies: string[];
}

/**
 * The heart of the running product: turn one inbound message into persisted
 * state and outbound sends. Shared verbatim by the webhook route and the dev
 * simulator, so what you click in the simulator exercises the exact code a real
 * iMessage would.
 *
 * Idempotent by construction: a duplicate event id is dropped before any state
 * changes, satisfying Linq's at-least-once delivery.
 */
export async function handleInboundMessage(
  message: InboundMessage,
  deps: ConversationDeps,
): Promise<HandleResult> {
  const fresh = await deps.store.markEventProcessed(message.eventId, "message.received");
  if (!fresh) return { processed: false, replies: [] };

  const command = parseCommand(message.text);

  // Opt-out / opt-in are handled independently of session state.
  if (command.kind === "STOP") {
    await deps.store.setOptedOut(message.senderHandle, true);
    await send(deps, message.linqChatId, [copy.OPTED_OUT]);
    return { processed: true, replies: [copy.OPTED_OUT] };
  }
  if (command.kind === "START") {
    await deps.store.setOptedOut(message.senderHandle, false);
    await send(deps, message.linqChatId, [copy.OPTED_IN]);
    return { processed: true, replies: [copy.OPTED_IN] };
  }
  if (await deps.store.isOptedOut(message.senderHandle)) {
    // A silenced member's messages are ignored entirely — no reply, no state.
    return { processed: true, replies: [] };
  }

  // One-to-one EAT is onboarding, not a decision session.
  if (!message.isGroup && command.kind === "EAT") {
    await send(deps, message.linqChatId, [ONBOARDING]);
    return { processed: true, replies: [ONBOARDING] };
  }

  const stored: StoredChat = (await deps.store.load(message.linqChatId)) ?? {
    linqChatId: message.linqChatId,
    isGroup: message.isGroup,
    snapshot: initialSnapshot(message.isGroup),
  };

  const { snapshot, replies } = await advance({
    snapshot: stored.snapshot,
    memberId: message.senderHandle,
    text: message.text,
    restaurants: deps.restaurants,
  });

  await deps.store.save({ ...stored, snapshot });

  const texts = replies.map((reply) => reply.text);
  await send(deps, message.linqChatId, texts);
  return { processed: true, replies: texts };
}

/**
 * Sends each reply into the existing chat. Replies flagged deferLink (they carry
 * a URL) are still sent normally here because the chat already exists — the URL
 * rule only bars the message that *creates* a chat, which onboarding handles
 * separately.
 */
async function send(deps: ConversationDeps, chatId: string, texts: string[]): Promise<void> {
  for (const text of texts) {
    await deps.messaging.sendMessage({ chatId, text });
  }
}
