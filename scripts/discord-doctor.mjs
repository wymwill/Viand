const required = ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID", "APP_BASE_URL"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is missing from .env.local.`);
}
if (!/^[0-9a-fA-F]{64}$/.test(process.env.DISCORD_PUBLIC_KEY)) {
  throw new Error("DISCORD_PUBLIC_KEY must be exactly 64 hexadecimal characters.");
}
if (!/^\d+$/.test(process.env.DISCORD_APPLICATION_ID)) {
  throw new Error("DISCORD_APPLICATION_ID must be the numeric application id from Discord's developer portal.");
}
const base = new URL(process.env.APP_BASE_URL);
if (base.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("APP_BASE_URL must be a public HTTPS URL; set Discord's Interactions Endpoint URL to APP_BASE_URL/api/webhooks/discord.");
}
const headers = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
const me = await fetch("https://discord.com/api/v10/users/@me", { headers });
if (!me.ok) throw new Error(`DISCORD_BOT_TOKEN is invalid (Discord returned HTTP ${me.status}).`);
const commandsResponse = await fetch(`https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/commands`, { headers });
if (!commandsResponse.ok) throw new Error(`DISCORD_APPLICATION_ID or bot access is wrong (command lookup returned HTTP ${commandsResponse.status}).`);
const commands = await commandsResponse.json();
if (!Array.isArray(commands) || commands.length === 0) {
  throw new Error("No global slash commands are registered for DISCORD_APPLICATION_ID; register at least one command or it will never appear.");
}
console.log(`Discord bot token is valid and ${commands.length} global slash command(s) are registered.`);
console.log(`Interactions endpoint should be ${new URL("/api/webhooks/discord", base)}.`);
