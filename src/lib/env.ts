import { z } from "zod";

/**
 * Single source of truth for configuration. Importing this module validates the
 * environment once and fails fast with a readable error if something required
 * is missing. Only server code may import it — it reaches secrets, so it must
 * never be pulled into a client component.
 */

const booleanish = z
  .string()
  .transform((value) => value.toLowerCase() === "true")
  .pipe(z.boolean());

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +15555550123");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    APP_NAME: z.string().default("Viand"),

    /**
     * Which transport actually moves messages. Leave unset to keep the legacy
     * USE_MOCK_LINQ behaviour; see resolveMessagingProvider below.
     */
    MESSAGING_PROVIDER: z.enum(["mock", "linq", "telegram", "discord", "slack"]).optional(),

    LINQ_API_KEY: z.string().optional(),
    LINQ_PHONE_NUMBER: e164.optional(),
    LINQ_WEBHOOK_SECRET: z.string().optional(),
    LINQ_WEBHOOK_VERSION: z.string().default("2026-02-03"),
    LINQ_API_BASE_URL: z.string().url().optional(),

    PHONE_NUMBER_DISPLAY: z.string().default("(555) 555-0123"),
    PHONE_NUMBER_E164: e164.default("+15555550123"),

    USE_MOCK_LINQ: booleanish.default(true),

    // Telegram Bot API. Free and keyless to receive; the token authenticates
    // every send. The username is only needed to strip the "/eat@ViandBot"
    // suffix Telegram appends to commands sent in groups.
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TELEGRAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be a 32-byte hex key").optional(),
    DISCORD_BOT_TOKEN: z.string().optional(),
    DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/, "must be a numeric application id").optional(),

    // Slack Events API. The signing secret verifies inbound deliveries; the
    // bot token sends. The bot's user id is only needed to recognise a mention,
    // which Slack renders as an id rather than a name.
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_BOT_USER_ID: z.string().optional(),
    SLACK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Structured AI interpretation of free-text messages. Off by default: the
    // deterministic parser is a complete implementation on its own.
    ANTHROPIC_API_KEY: z.string().optional(),
    USE_AI_INTERPRETER: booleanish.default(false),
    AI_INTERPRETER_MODEL: z.string().default("claude-haiku-4-5"),
    AI_INTERPRETER_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
    AI_INTERPRETER_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(500),
    AI_INTERPRETER_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    /**
     * Spending bounds for the interpreter. Two caps: one chat cannot loop away
     * a budget, and many chats each under their own limit cannot either. Both
     * degrade to the deterministic parser, which answers on its own.
     */
    AI_INTERPRETER_MAX_CALLS_PER_CHAT: z.coerce.number().int().positive().default(30),
    AI_INTERPRETER_CHAT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3_600),
    AI_INTERPRETER_MAX_CALLS_PER_DAY: z.coerce.number().int().positive().default(1_000),

    // Live restaurant data from keyless, volunteer-run OpenStreetMap services.
    USE_MOCK_RESTAURANTS: booleanish.default(true),
    /** Comma-separated. The first valid response wins within one deadline. */
    OVERPASS_URL: z
      .string()
      .default(
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter," +
          "https://overpass.kumi.systems/api/interpreter," +
          "https://overpass-api.de/api/interpreter",
      ),
    /** How long a search is reused before re-fetching. Restaurants move slowly. */
    RESTAURANT_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
    /**
     * Listings kept per cached search, chosen round-robin across cuisines.
     *
     * Measured rather than guessed: at 25 a group containing one vegetarian
     * dropped to a single option in Denver and Washington and two in Chicago,
     * because the restaurants carrying dietary tags are a small minority and
     * rarely the closest. At 60 the same groups got three and four. Five
     * options are only ever shown, but the scorer can only choose among what
     * it was given.
     */
    RESTAURANT_CACHE_MAX_RESULTS: z.coerce.number().int().positive().default(60),
    NOMINATIM_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
    /** Nominatim's usage policy requires an identifying User-Agent. */
    OSM_USER_AGENT: z.string().default("Viand/0.1 (restaurant decision bot)"),
    /** Nominatim stays short so a slow geocode cannot consume the search budget. */
    NOMINATIM_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    /** Total Overpass budget shared across the configured endpoints. */
    OSM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Ceiling for the full-radius Overpass query; a cheap 1.5km first pass runs before this is ever reached. */
    OSM_MAX_QUERY_RADIUS_METRES: z.coerce.number().int().positive().default(8_100),
  })
  .superRefine((env, ctx) => {
    // Credentials are required by the transport that is actually selected, so a
    // stale USE_MOCK_LINQ=false cannot demand Linq keys from a Telegram deploy.
    const provider = resolveProvider(env.MESSAGING_PROVIDER, env.USE_MOCK_LINQ);

    if (provider === "linq") {
      for (const key of ["LINQ_API_KEY", "LINQ_PHONE_NUMBER", "LINQ_WEBHOOK_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when the messaging provider is "linq"`,
          });
        }
      }
    }

    if (provider === "telegram") {
      for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when MESSAGING_PROVIDER=telegram`,
          });
        }
      }
    }

    if (provider === "discord") {
      for (const key of ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"] as const) {
        if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when MESSAGING_PROVIDER=discord` });
      }
    }

    if (env.USE_AI_INTERPRETER && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when USE_AI_INTERPRETER=true",
      });
    }

    if (Boolean(env.UPSTASH_REDIS_REST_URL) !== Boolean(env.UPSTASH_REDIS_REST_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.UPSTASH_REDIS_REST_URL ? "UPSTASH_REDIS_REST_TOKEN" : "UPSTASH_REDIS_REST_URL"],
        message: "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together",
      });
    }

  });

export type Env = z.infer<typeof schema>;

export type MessagingProviderName = "mock" | "linq" | "telegram" | "discord" | "slack";

/**
 * Shared by the schema's own validation and by the provider factory, so the
 * selection rule is stated exactly once.
 */
function resolveProvider(
  provider: MessagingProviderName | undefined,
  useMockLinq: boolean,
): MessagingProviderName {
  return provider ?? (useMockLinq ? "mock" : "linq");
}

/**
 * The transport this environment should use. An unset MESSAGING_PROVIDER falls
 * back to USE_MOCK_LINQ, so every .env.local written before Telegram existed
 * keeps behaving exactly as it did.
 */
export function resolveMessagingProvider(env: Env): MessagingProviderName {
  return resolveProvider(env.MESSAGING_PROVIDER, env.USE_MOCK_LINQ);
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the memoized env so a new process.env can be re-read. */
export function resetEnvCache(): void {
  cached = null;
}
