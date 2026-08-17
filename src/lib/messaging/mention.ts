export interface NormalisedMention {
  readonly text: string;
  readonly wasInvoked: boolean;
}

/** Removes the plain-text spelling used by SMS and the simulator. */
export function normalisePlainMention(text: string): NormalisedMention {
  const mention = /@viand\b/gi;
  const wasInvoked = mention.test(text);
  return {
    text: text.replace(mention, " ").replace(/[ \t]+/g, " ").trim(),
    wasInvoked,
  };
}
