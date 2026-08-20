import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { MessageInterpreter } from "@/domain/interpret/types";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { handleInboundMessage, type InboundMessage } from "@/lib/conversation/service";
import { getMessageInterpreter } from "@/lib/interpret";
import { getMessagingProvider, getMockMessagingProvider } from "@/lib/messaging";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { getRestaurantProvider } from "@/lib/restaurants";
import { InMemorySessionStore } from "@/lib/store/memory-store";
import { getSessionStore } from "@/lib/store";
import type { SessionStore } from "@/lib/store/types";

type Runtime = {
  store: SessionStore;
  restaurants: RestaurantProvider;
  interpreter: MessageInterpreter;
};

/**
 * Bumped whenever `Runtime` gains or loses a field.
 *
 * The runtimes are cached on globalThis so state survives module reloads in
 * dev. That cache outlives the module that created it, so after a shape change
 * `??=` would happily reuse an object built by the previous shape and hand back
 * a runtime missing its newest dependency — which surfaces much later as an
 * undefined property, not as a load error. Versioning the key makes an
 * incompatible cache entry unreachable instead of subtly wrong.
 */
const RUNTIME_VERSION = 2;

const globalRuntime = globalThis as typeof globalThis & {
  [key: `__viandRuntimeV${number}`]: Runtime | undefined;
  [key: `__viandSimulationRuntimeV${number}`]: Runtime | undefined;
};

const LIVE_KEY = `__viandRuntimeV${RUNTIME_VERSION}` as const;
const SIMULATION_KEY = `__viandSimulationRuntimeV${RUNTIME_VERSION}` as const;

function getLiveRuntime(): Runtime {
  if (!globalRuntime[LIVE_KEY]) {
    // The interpreter's spending caps count through the same store, so it is
    // built from the one this runtime will actually use.
    const store = getSessionStore();
    globalRuntime[LIVE_KEY] = {
      store,
      restaurants: getRestaurantProvider(),
      interpreter: getMessageInterpreter(store),
    };
  }
  return globalRuntime[LIVE_KEY];
}

/**
 * The dashboard is unauthenticated, so every integration is deterministic and
 * local: in-memory storage, mock messaging, mock restaurants, and the rules
 * interpreter. It must never use Redis or spend Linq, OSM, or model capacity
 * regardless of production settings.
 */
function getSimulationRuntime(): Runtime {
  globalRuntime[SIMULATION_KEY] ??= {
    store: new InMemorySessionStore(),
    restaurants: new MockRestaurantProvider(),
    interpreter: new DeterministicInterpreter(),
  };
  return globalRuntime[SIMULATION_KEY];
}

async function processWith(
  runtime: Runtime,
  message: InboundMessage,
  messaging: MessagingProvider,
) {
  const result = await handleInboundMessage(message, {
    store: runtime.store,
    messaging,
    restaurants: runtime.restaurants,
    interpreter: runtime.interpreter,
  });
  const chat = await runtime.store.load(message.linqChatId);
  return { ...result, snapshot: chat?.snapshot ?? null };
}

/** Live webhook path: follows USE_MOCK_LINQ and may send through real Linq. */
export function processMessage(message: InboundMessage) {
  return processWith(getLiveRuntime(), message, getMessagingProvider());
}

export function processMessageWithProvider(message: InboundMessage, messaging: MessagingProvider) {
  return processWith(getLiveRuntime(), message, messaging);
}

/** Dashboard-only path: separate state and no Linq calls, even in live mode. */
export function processSimulatedMessage(message: InboundMessage) {
  return processWith(getSimulationRuntime(), message, getMockMessagingProvider());
}

export function resetRuntime(): void {
  resetStore(globalRuntime[LIVE_KEY]?.store);
  resetStore(globalRuntime[SIMULATION_KEY]?.store);
}

function resetStore(store: SessionStore | undefined): void {
  if (store && "reset" in store && typeof store.reset === "function") store.reset();
}
