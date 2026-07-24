import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { handleInboundMessage, type InboundMessage } from "@/lib/conversation/service";
import { getMessagingProvider } from "@/lib/messaging";
import { InMemorySessionStore } from "@/lib/store/memory-store";

type Runtime = {
  store: InMemorySessionStore;
  restaurants: MockRestaurantProvider;
};

const globalRuntime = globalThis as typeof globalThis & {
  __viandRuntime?: Runtime;
};

function getRuntime(): Runtime {
  globalRuntime.__viandRuntime ??= {
    store: new InMemorySessionStore(),
    restaurants: new MockRestaurantProvider(),
  };
  return globalRuntime.__viandRuntime;
}

export async function processMessage(message: InboundMessage) {
  const runtime = getRuntime();
  const result = await handleInboundMessage(message, {
    store: runtime.store,
    messaging: getMessagingProvider(),
    restaurants: runtime.restaurants,
  });
  const chat = await runtime.store.load(message.linqChatId);
  return { ...result, snapshot: chat?.snapshot ?? null };
}

export function resetRuntime(): void {
  getRuntime().store.reset();
}
