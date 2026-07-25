import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import type { MessageInterpreter } from "@/domain/interpret/types";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { handleInboundMessage, type InboundMessage } from "@/lib/conversation/service";
import { getMessageInterpreter } from "@/lib/interpret";
import { getMessagingProvider, getMockMessagingProvider } from "@/lib/messaging";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { getRestaurantProvider } from "@/lib/restaurants";
import { InMemorySessionStore } from "@/lib/store/memory-store";

type Runtime = {
  store: InMemorySessionStore;
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
  globalRuntime[LIVE_KEY] ??= {
    store: new InMemorySessionStore(),
    restaurants: getRestaurantProvider(),
    interpreter: getMessageInterpreter(),
  };
  return globalRuntime[LIVE_KEY];
}

/**
 * The dashboard is unauthenticated and its chat id is not a real place, so it
 * never spends Places quota or model tokens — the same reason it never sends
 * through real Linq. Mock data and the deterministic parser exercise the whole
 * conversation path without reaching any paid third party.
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

/** Dashboard-only path: separate state and no Linq calls, even in live mode. */
export function processSimulatedMessage(message: InboundMessage) {
  return processWith(getSimulationRuntime(), message, getMockMessagingProvider());
}

export function resetRuntime(): void {
  globalRuntime[LIVE_KEY]?.store.reset();
  globalRuntime[SIMULATION_KEY]?.store.reset();
}
