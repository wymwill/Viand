#!/usr/bin/env node
/**
 * Checks a Slack configuration and names the specific setting that is wrong.
 *
 * Slack's failure mode is silence: an app missing history scopes, or not
 * invited to the channel, receives nothing at all and looks broken rather than
 * misconfigured. This is the same class of problem as Telegram privacy mode,
 * and the same reason `discord:doctor` exists.
 */

const token = process.env.SLACK_BOT_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const botUserId = process.env.SLACK_BOT_USER_ID;
const appBaseUrl = process.env.APP_BASE_URL;

const problems = [];

if (!token) problems.push("SLACK_BOT_TOKEN is not set.");
else if (!token.startsWith("xoxb-")) {
  problems.push("SLACK_BOT_TOKEN should be a bot token beginning xoxb- (not a user or app token).");
}
if (!signingSecret) problems.push("SLACK_SIGNING_SECRET is not set; inbound events cannot be verified.");

if (!appBaseUrl) problems.push("APP_BASE_URL is not set.");
else {
  const url = new URL(appBaseUrl);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
    problems.push(`APP_BASE_URL must be a public HTTPS URL; Slack cannot reach ${appBaseUrl}.`);
  }
}

if (problems.length > 0) {
  console.error("Configuration problems:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const REQUIRED_SCOPES = ["chat:write", "channels:history"];

const auth = await (
  await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
).json();

if (!auth.ok) {
  console.error(`Slack rejected the bot token: ${auth.error}`);
  process.exit(1);
}

console.log(`Token valid for workspace "${auth.team}" as "${auth.user}" (${auth.user_id}).`);

if (!botUserId) {
  console.warn(
    `SLACK_BOT_USER_ID is not set. Without it a mention cannot be recognised — set it to ${auth.user_id}.`,
  );
} else if (botUserId !== auth.user_id) {
  console.error(
    `SLACK_BOT_USER_ID is ${botUserId} but this token belongs to ${auth.user_id}; mentions will never match.`,
  );
  process.exit(1);
}

// auth.test does not report scopes, but any scoped call does via a header.
const probe = await fetch("https://slack.com/api/conversations.list?limit=1", {
  headers: { Authorization: `Bearer ${token}` },
});
const granted = (probe.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim());
const missing = REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));

if (missing.length > 0) {
  console.error(`Missing bot scopes: ${missing.join(", ")}. Reinstall the app after adding them.`);
  process.exit(1);
}

console.log(`Scopes present: ${REQUIRED_SCOPES.join(", ")}.`);
console.log(`Set the Request URL to ${new URL("/api/webhooks/slack", appBaseUrl).toString()}`);
console.log("Then invite the bot to a channel: /invite @Viand");
