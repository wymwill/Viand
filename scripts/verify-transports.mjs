#!/usr/bin/env node
/**
 * Checks every configured transport end to end against the live deployment.
 *
 * Each platform fails silently in its own way — Telegram with privacy mode,
 * Discord with an unset interactions URL, Slack with a missing channel
 * invitation — so "it looks fine" is worth nothing. This exercises the parts
 * that can be exercised without a human in a chat: credentials, registration,
 * and whether the webhook accepts a genuine request and rejects a forged one.
 *
 * Run it after rotating any credential.
 *
 *   npm run transports:verify
 */
import { createHmac } from "node:crypto";

const baseUrl = process.env.APP_BASE_URL;
if (!baseUrl || !baseUrl.startsWith("https://")) {
  console.error("APP_BASE_URL must be the public HTTPS deployment, e.g. https://your-app.vercel.app");
  process.exit(1);
}

let failures = 0;
const pass = (label, detail = "") => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail) => {
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};
const skip = (label) => console.log(`  skip  ${label} (not configured)`);

async function json(url, init) {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json().catch(() => null), response };
}

/* ------------------------------- Telegram ------------------------------- */
console.log("\nTelegram");
if (!process.env.TELEGRAM_BOT_TOKEN) skip("telegram");
else {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const me = await json(`https://api.telegram.org/bot${token}/getMe`);
  if (me.body?.ok) {
    const bot = me.body.result;
    pass("bot token", `@${bot.username}`);
    if (bot.can_read_all_group_messages) pass("privacy mode disabled");
    else fail("privacy mode", "still ON — the bot receives nothing in groups but direct mentions");
    if (bot.username !== process.env.TELEGRAM_BOT_USERNAME) {
      fail("TELEGRAM_BOT_USERNAME", `env says ${process.env.TELEGRAM_BOT_USERNAME}, bot is ${bot.username}`);
    } else pass("username matches env");
  } else fail("bot token", me.body?.description ?? "rejected");

  const hook = await json(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = hook.body?.result ?? {};
  const expected = new URL("/api/webhooks/telegram", baseUrl).toString();
  if (info.url === expected) pass("webhook url", expected);
  else fail("webhook url", `expected ${expected}, got ${info.url || "(none)"}`);
  if (info.last_error_message) fail("recent delivery", info.last_error_message);
  else pass("recent deliveries", `${info.pending_update_count ?? 0} pending, no errors`);

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const good = await fetch(expected, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify({ update_id: Date.now(), message: { message_id: 1, text: "/status", chat: { id: -1009999, type: "supergroup" }, from: { id: 1 } } }),
    });
    good.ok ? pass("webhook accepts a correct secret", `HTTP ${good.status}`) : fail("webhook accepts a correct secret", `HTTP ${good.status}`);

    const bad = await fetch(expected, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" },
      body: "{}",
    });
    bad.status === 401 ? pass("webhook rejects a wrong secret") : fail("webhook rejects a wrong secret", `HTTP ${bad.status}`);
  }
}

/* -------------------------------- Discord ------------------------------- */
console.log("\nDiscord");
if (!process.env.DISCORD_BOT_TOKEN) skip("discord");
else {
  const auth = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  const app = await json("https://discord.com/api/v10/applications/@me", { headers: auth });
  if (app.body?.id) pass("bot token", app.body.name);
  else fail("bot token", app.body?.message ?? "rejected");

  const expected = new URL("/api/webhooks/discord", baseUrl).toString();
  if (app.body?.interactions_endpoint_url === expected) pass("interactions endpoint", expected);
  else fail("interactions endpoint", `expected ${expected}, got ${app.body?.interactions_endpoint_url || "(unset)"}`);

  const guilds = await json("https://discord.com/api/v10/users/@me/guilds", { headers: auth });
  Array.isArray(guilds.body) && guilds.body.length > 0
    ? pass("installed in a server", `${guilds.body.length}`)
    : fail("installed in a server", "the bot is in no servers, so nobody can invoke it");

  const id = process.env.DISCORD_APPLICATION_ID;
  const commands = await json(`https://discord.com/api/v10/applications/${id}/commands`, { headers: auth });
  Array.isArray(commands.body) && commands.body.length > 0
    ? pass("commands registered", commands.body.map((c) => `/${c.name}`).join(" "))
    : fail("commands registered", "none — the command will not appear");

  // Cannot forge a Discord signature without their private key, but the
  // endpoint must reject an invalid one rather than process it.
  const forged = await fetch(expected, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature-ed25519": "00", "x-signature-timestamp": "1" },
    body: JSON.stringify({ type: 1 }),
  });
  forged.status === 401 ? pass("endpoint rejects a forged signature") : fail("endpoint rejects a forged signature", `HTTP ${forged.status}`);
}

/* --------------------------------- Slack -------------------------------- */
console.log("\nSlack");
if (!process.env.SLACK_BOT_TOKEN) skip("slack");
else {
  const auth = await json("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  if (auth.body?.ok) pass("bot token", `${auth.body.team} / ${auth.body.user}`);
  else fail("bot token", auth.body?.error ?? "rejected");

  if (process.env.SLACK_BOT_USER_ID === auth.body?.user_id) pass("bot user id matches env");
  else fail("bot user id", `env says ${process.env.SLACK_BOT_USER_ID}, token is ${auth.body?.user_id} — mentions will never match`);

  const scopeProbe = await fetch("https://slack.com/api/conversations.list?limit=1", {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const granted = (scopeProbe.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim());
  const missing = ["chat:write", "channels:history"].filter((s) => !granted.includes(s));
  missing.length === 0 ? pass("required scopes") : fail("required scopes", `missing ${missing.join(", ")}`);

  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) fail("signing secret", "not set; inbound events cannot be verified");
  else {
    const url = new URL("/api/webhooks/slack", baseUrl).toString();
    const sign = (body, ts) => "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
    const send = (body, ts, sig) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-slack-request-timestamp": String(ts), "x-slack-signature": sig ?? sign(body, ts) },
        body,
      });

    const now = Math.floor(Date.now() / 1000);
    const challenge = JSON.stringify({ type: "url_verification", challenge: "verify-me" });
    const ok = await send(challenge, now);
    const okBody = await ok.json().catch(() => null);
    okBody?.challenge === "verify-me" ? pass("endpoint answers the URL handshake") : fail("endpoint answers the URL handshake", `HTTP ${ok.status}`);

    const tampered = await send(JSON.stringify({ type: "url_verification", challenge: "evil" }), now, sign(challenge, now));
    tampered.status === 401 ? pass("rejects a tampered body") : fail("rejects a tampered body", `HTTP ${tampered.status}`);

    const stale = await send(challenge, now - 3 * 3600);
    stale.status === 401 ? pass("rejects a replayed request") : fail("rejects a replayed request", `HTTP ${stale.status}`);
  }
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All configured transports verified.");
