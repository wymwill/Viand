#!/usr/bin/env node
/**
 * Registers Viand's global slash command with Discord.
 *
 * Separate from `discord:doctor`, which only reports that no command exists.
 * Discord will happily accept an interactions endpoint with zero commands
 * registered, and the failure then looks like the bot being silent rather than
 * like a configuration error — the same shape as Telegram's privacy mode.
 *
 * Global commands can take up to an hour to appear in every guild.
 */

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !botToken) {
  console.error(
    "Missing configuration. Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env.local.",
  );
  process.exit(1);
}

const command = {
  name: "eat",
  description: "Start a group restaurant decision, or add what you want to one already running",
  type: 1,
  // Everything the group says arrives as one free-text argument, so the
  // deterministic parser sees the same shape it sees on every other transport.
  options: [
    {
      name: "message",
      description: 'What you want — "Mexican under $25", "I\'m vegetarian", "2"',
      type: 3,
      required: false,
    },
  ],
};

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
  {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  },
);

const body = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`Registration failed: HTTP ${response.status}`);
  if (body) console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`Registered /${body.name} (id ${body.id}) for application ${applicationId}.`);
console.log("Global commands can take up to an hour to propagate to every guild.");
