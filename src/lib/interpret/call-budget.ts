import type { SessionStore } from "../store/types";

/**
 * Bounds what the interpreter may spend.
 *
 * The simulator is unauthenticated and every interpreted message costs money,
 * so without a bound a stuck loop in one chat — or a hostile visitor — sets the
 * bill. The counters live behind the SessionStore seam because the bound has to
 * hold across serverless instances that share no memory; a process-local
 * counter on Vercel bounds nothing.
 *
 * Two caps, checked in order. The per-chat window catches one runaway
 * conversation. The daily ceiling catches breadth — many chats each sitting
 * politely under their own limit still add up.
 *
 * The per-chat counter increments on every attempt, allowed or not: a cap that
 * only counts permitted calls can be probed past for free once tripped. The
 * daily counter is charged only after an attempt clears the per-chat gate,
 * since those are the only attempts that would otherwise have reached a model.
 */

export interface CallBudgetLimits {
  readonly perChatMax: number;
  readonly perChatWindowSeconds: number;
  readonly dailyMax: number;
}

export type BudgetDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface InterpreterBudget {
  check(chatId: string): Promise<BudgetDecision>;
}

const DAY_SECONDS = 24 * 60 * 60;

export class SessionStoreCallBudget implements InterpreterBudget {
  constructor(
    private readonly store: SessionStore,
    private readonly limits: CallBudgetLimits,
  ) {}

  async check(chatId: string): Promise<BudgetDecision> {
    const perChat = await this.store.incrementCounter(
      `interpreter:chat:${chatId}`,
      this.limits.perChatWindowSeconds,
    );
    if (perChat > this.limits.perChatMax) {
      return { allowed: false, reason: "per_chat_cap" };
    }

    const daily = await this.store.incrementCounter("interpreter:daily", DAY_SECONDS);
    if (daily > this.limits.dailyMax) {
      return { allowed: false, reason: "daily_cap" };
    }

    return { allowed: true };
  }
}

/**
 * Used when no store is available. Refusing rather than allowing is the safe
 * default: an uncounted call is an unbounded one.
 */
export const DENY_ALL_BUDGET: InterpreterBudget = {
  check: async () => ({ allowed: false, reason: "no_budget_configured" }),
};
