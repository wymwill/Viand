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
 * The dashboard never sends a real text and never spends model tokens: its chat
 * id is not a real conversation, and the endpoint is unauthenticated.
 *
 * Restaurants are the exception — they follow the configured provider, so the
 * simulator shows the same listings a real group would get. That is the point
 * of the simulator, and the live source costs nothing per request. Note this
 * does put the public dashboard on Overpass, a volunteer-run service: if this
 * is ever exposed to real traffic, point OVERPASS_URL at a paid or self-hosted
 * instance rather than leaning on the shared one.
 */
function getSimulationRuntime(): Runtime {
  globalRuntime[SIMULATION_KEY] ??= {
    store: new InMemorySessionStore(),
    restaurants: simulationRestaurants(),
    interpreter: new DeterministicInterpreter(),
  };
  return globalRuntime[SIMULATION_KEY];
}

/**
 * Choosing a provider reads the environment, and the environment can be invalid
 * for reasons that have nothing to do with the dashboard — half-entered Linq
 * credentials being the obvious one. The dashboard must never 500 because the
 * live integration is mid-setup, so anything unreadable degrades to the demo
 * catalogue instead of throwing.
 */
function simulationRestaurants(): RestaurantProvider {
  try {
    return getRestaurantProvider();
  } catch {
    return new MockRestaurantProvider();
  }
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
