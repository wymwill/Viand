#!/usr/bin/env node
/**
 * Publishes Viand's command menu to Telegram.
 *
 * Without this the "/" menu in a chat is empty, so nobody discovers that the
 * bot does anything — the same silent-looking failure as an unregistered
 * Discord slash command or a bot left in privacy mode.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing configuration. Set TELEGRAM_BOT_TOKEN in .env.local.");
  process.exit(1);
}

const commands = [
  { command: "eat", description: "Start deciding where the group should eat" },
  { command: "status", description: "Show where the current decision has got to" },
  { command: "done", description: "Finish answering and see the options" },
  { command: "cancel", description: "Cancel the current decision" },
  { command: "help", description: "How Viand works" },
];

const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands }),
});

const payload = await response.json().catch(() => null);

if (!response.ok || !payload?.ok) {
  console.error(`setMyCommands failed: ${payload?.description ?? response.status}`);
  process.exit(1);
}

console.log(`Registered ${commands.length} commands: ${commands.map((c) => "/" + c.command).join(" ")}`);
