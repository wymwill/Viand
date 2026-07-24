import { getEnv } from "../env";
import { LinqMessagingProvider } from "./linq-provider";
import { MockMessagingProvider } from "./mock-provider";
import type { MessagingProvider } from "./provider";

let mockSingleton: MockMessagingProvider | null = null;

/**
 * Returns the messaging provider the current environment should use. The mock
 * is a singleton so its recorded history survives across requests in dev and in
 * the simulator; the real provider is created per call (it holds no state).
 * LinqMessagingProvider's constructor is what reads Linq credentials, so it is
 * only instantiated on the non-mock path — importing the module is harmless.
 */
export function getMessagingProvider(): MessagingProvider {
  if (getEnv().USE_MOCK_LINQ) {
    mockSingleton ??= new MockMessagingProvider();
    return mockSingleton;
  }
  return new LinqMessagingProvider();
}

/** Test/dev helper: the shared mock instance, creating it if needed. */
export function getMockMessagingProvider(): MockMessagingProvider {
  mockSingleton ??= new MockMessagingProvider();
  return mockSingleton;
}

export function resetMockMessagingProvider(): void {
  mockSingleton = null;
}
