import LinqAPIV3 from "@linqapp/sdk";

const apiKey = process.env.LINQ_API_KEY;
const phoneNumber = process.env.LINQ_PHONE_NUMBER;
const appBaseUrl = process.env.APP_BASE_URL;
const version = process.env.LINQ_WEBHOOK_VERSION ?? "2026-02-03";

if (!apiKey || !phoneNumber || !appBaseUrl) {
  throw new Error(
    "LINQ_API_KEY, LINQ_PHONE_NUMBER, and APP_BASE_URL are required in .env.local.",
  );
}

const baseUrl = new URL(appBaseUrl);
if (baseUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  throw new Error("APP_BASE_URL must be a public HTTPS URL before registering a webhook.");
}

const target = new URL("/api/webhooks/linq", baseUrl);
target.searchParams.set("version", version);

const client = new LinqAPIV3({ apiKey });
const subscription = await client.webhookSubscriptions.create({
  target_url: target.toString(),
  subscribed_events: ["message.received"],
  phone_numbers: [phoneNumber],
});

console.log(`Created Linq webhook subscription ${subscription.id}.`);
console.log(`Target: ${subscription.target_url}`);
console.log("Store this one-time value in .env.local, then restart the app:");
console.log(`LINQ_WEBHOOK_SECRET=${subscription.signing_secret}`);
