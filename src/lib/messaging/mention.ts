export interface NormalisedMention {
  readonly text: string;
  readonly wasInvoked: boolean;
}

/**
 * Removes the plain-text spelling used by SMS and the simulator.
 *
 * The mention must stand alone. A `\b` boundary also matched inside an email
 * address, so "ping person@viand.com" both lost its domain and was treated as
 * an explicit invocation — which silently started a decision session off an
 * ordinary message. A mention is therefore only recognised when it is not
 * glued to preceding text and is not followed by a word character or a dot.
 */
const MENTION = /(^|[^\w@.])@viand(?![\w.])/gi;

export function normalisePlainMention(text: string): NormalisedMention {
  MENTION.lastIndex = 0;
  const wasInvoked = MENTION.test(text);
  MENTION.lastIndex = 0;
  return {
    text: text.replace(MENTION, "$1 ").replace(/[ \t]+/g, " ").trim(),
    wasInvoked,
  };
}
