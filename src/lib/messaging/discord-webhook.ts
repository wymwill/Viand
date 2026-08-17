import type { InboundMessage } from "../conversation/service";

export interface DiscordInteraction {
  readonly id?: string;
  readonly type?: number;
  readonly application_id?: string;
  readonly token?: string;
  readonly guild_id?: string;
  readonly channel_id?: string;
  readonly member?: { readonly user?: { readonly id?: string } };
  readonly user?: { readonly id?: string };
  readonly data?: {
    readonly name?: string;
    readonly options?: ReadonlyArray<{ readonly name?: string; readonly value?: unknown }>;
  };
}

export function normaliseDiscordText(text: string): { text: string; wasInvoked: boolean } {
  const mention = /<@!?\d+>/g;
  const wasInvoked = mention.test(text);
  return { text: text.replace(mention, " ").replace(/\s+/g, " ").trim(), wasInvoked };
}

export function inboundFromDiscord(interaction: DiscordInteraction): InboundMessage | null {
  if (interaction.type !== 2 || !interaction.id || !interaction.channel_id) return null;
  const sender = interaction.member?.user?.id ?? interaction.user?.id;
  if (!sender || !interaction.data?.name) return null;
  const values = interaction.data.options?.map((option) => String(option.value ?? "")) ?? [];
  const text = [interaction.data.name, ...values].join(" ").trim();
  return {
    eventId: `discord:${interaction.id}`,
    linqChatId: interaction.channel_id,
    isGroup: Boolean(interaction.guild_id),
    senderHandle: `discord:${sender}`,
    text,
    wasInvoked: true,
  };
}
