const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appBaseUrl = process.env.APP_BASE_URL;

if (!token || !secret || !appBaseUrl) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and APP_BASE_URL are required in .env.local.",
  );
}

const baseUrl = new URL(appBaseUrl);
if (baseUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  throw new Error("APP_BASE_URL must be a public HTTPS URL before registering a webhook.");
}

const target = new URL("/api/webhooks/telegram", baseUrl);

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: target.toString(),
    secret_token: secret,
    // Only plain messages drive the conversation; edits and callbacks are noise.
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});

const payload = await response.json();
if (!response.ok || !payload.ok) {
  throw new Error(`setWebhook failed: ${payload.description ?? response.status}`);
}

console.log(`Registered Telegram webhook at ${target.toString()}.`);
console.log("");
console.log("If the bot should read every message in a group (it must, to collect");
console.log("preferences from each member), disable privacy mode in BotFather:");
console.log("  /setprivacy -> select this bot -> Disable");
console.log("Then remove and re-add the bot to any existing group.");
