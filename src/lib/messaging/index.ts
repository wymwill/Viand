import { getEnv, resolveMessagingProvider } from "../env";
import { LinqMessagingProvider } from "./linq-provider";
import { MockMessagingProvider } from "./mock-provider";
import { TelegramMessagingProvider } from "./telegram-provider";
import { DiscordMessagingProvider } from "./discord-provider";
import { SlackMessagingProvider } from "./slack-provider";
import type { MessagingProvider } from "./provider";

let mockSingleton: MockMessagingProvider | null = null;

/**
 * Returns the messaging provider the current environment should use. The mock
 * is a singleton so its recorded history survives across requests in dev and in
 * the simulator; the real providers are created per call (they hold no state).
 * Each real provider's constructor is what reads its credentials, so only the
 * selected one is ever instantiated — importing the modules is harmless.
 */
export function getMessagingProvider(): MessagingProvider {
  switch (resolveMessagingProvider(getEnv())) {
    case "linq":
      return new LinqMessagingProvider();
    case "telegram":
      return new TelegramMessagingProvider();
    case "discord":
      return new DiscordMessagingProvider();
    case "slack":
      return new SlackMessagingProvider();
    case "mock":
      mockSingleton ??= new MockMessagingProvider();
      return mockSingleton;
  }
}

/** Test/dev helper: the shared mock instance, creating it if needed. */
export function getMockMessagingProvider(): MockMessagingProvider {
  mockSingleton ??= new MockMessagingProvider();
  return mockSingleton;
}

export function resetMockMessagingProvider(): void {
  mockSingleton = null;
}
