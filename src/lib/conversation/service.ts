import { advance } from "@/domain/state-machine/engine";
import { initialSnapshot } from "@/domain/state-machine/session";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { idleDisposition, parseCommand } from "@/domain/commands";
import type { MessageInterpreter } from "@/domain/interpret/types";
import * as copy from "@/domain/messages/copy";
import { ONBOARDING } from "@/domain/messages/copy";
import type { MessagingProvider } from "../messaging/provider";
import { chatRef, logDegradation } from "../observability/log";
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
  /** Transport syntax explicitly addressed this message to Viand. */
  wasInvoked: boolean;
}

export interface ConversationDeps {
  store: SessionStore;
  messaging: MessagingProvider;
  restaurants: RestaurantProvider;
  interpreter: MessageInterpreter;
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

  // A bare transport mention has no content after adapter syntax is stripped,
  // but retains the historical meaning of a bare "Viand" wake phrase.
  const command = message.wasInvoked && message.text.length === 0
    ? ({ kind: "PICK_A_PLACE" } as const)
    : parseCommand(message.text);

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

  const existing = await deps.store.load(message.linqChatId);
  const isIdle =
    existing == null ||
    existing.snapshot.state === "COMPLETED" ||
    existing.snapshot.state === "CANCELLED";

  // Group chats are noisy. With nothing running, only an intentional invocation
  // starts a decision; HELP and CANCEL are answered without creating any state,
  // so a stray HELP cannot leave the chat parked in COLLECTING_LOCATION where
  // the next unrelated message would be read as a location.
  if (isIdle) {
    const disposition = idleDisposition(command, message.wasInvoked);
    if (disposition === "ignore") return { processed: true, replies: [] };
    if (disposition === "answer") {
      const text = command.kind === "HELP" ? copy.HELP : copy.NOTHING_RUNNING;
      await send(deps, message.linqChatId, [text]);
      return { processed: true, replies: [text] };
    }
  }

  const stored: StoredChat = existing ?? {
    linqChatId: message.linqChatId,
    isGroup: message.isGroup,
    snapshot: initialSnapshot(message.isGroup),
  };

  // Interpretation resolves free text only — the deterministic command above is
  // authoritative for anything it recognised. The interpreter reads its inputs
  // and returns a value; it never sends, stores, or mutates session state.
  const interpretation = await deps.interpreter.interpret({
    text: message.text,
    command,
    state: stored.snapshot.state,
    optionNames: stored.snapshot.candidates.map((candidate) => candidate.restaurant.name),
    chatId: message.linqChatId,
  });

  const { snapshot, replies } = await advance({
    snapshot: stored.snapshot,
    memberId: message.senderHandle,
    interpretation,
    restaurants: deps.restaurants,
    now: new Date(),
    onDegradation: (event, cause) =>
      logDegradation(event as never, { chat: chatRef(message.linqChatId) }, cause),
  });

  await deps.store.save({ ...stored, snapshot });

  const texts = replies.map((reply) => reply.text);
  const delivered = await send(deps, message.linqChatId, texts);
  return { processed: true, replies: delivered };
}

/**
 * Sends each reply into the existing chat. Replies flagged deferLink (they carry
 * a URL) are still sent normally here because the chat already exists — the URL
 * rule only bars the message that *creates* a chat, which onboarding handles
 * separately.
 *
 * A failed send is logged and swallowed rather than thrown. By this point the
 * event is already marked processed and the new snapshot saved, so letting the
 * error escape returned a 500 that told the transport to redeliver something
 * already handled — and the commonest causes, a blocked bot or a chat the bot
 * was removed from, never succeed on retry. Returning what actually went out
 * keeps the caller honest about it.
 */
async function send(
  deps: ConversationDeps,
  chatId: string,
  texts: string[],
): Promise<string[]> {
  const delivered: string[] = [];

  for (const text of texts) {
    try {
      await deps.messaging.sendMessage({ chatId, text });
      delivered.push(text);
    } catch (error) {
      logDegradation(
        "reply_delivery_failed",
        { chat: chatRef(chatId), sent: delivered.length, total: texts.length },
        error,
      );
      // Later replies in a turn read as nonsense without the earlier ones, and
      // whatever broke the first send almost always breaks the rest.
      break;
    }
  }

  return delivered;
}
