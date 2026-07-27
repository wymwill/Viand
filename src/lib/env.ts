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
    MESSAGING_PROVIDER: z.enum(["mock", "linq", "telegram"]).optional(),

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

    // Structured AI interpretation of free-text messages. Off by default: the
    // deterministic parser is a complete implementation on its own.
    ANTHROPIC_API_KEY: z.string().optional(),
    USE_AI_INTERPRETER: booleanish.default(false),
    AI_INTERPRETER_MODEL: z.string().default("claude-haiku-4-5"),
    AI_INTERPRETER_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
    AI_INTERPRETER_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(500),
    AI_INTERPRETER_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),

    // Live restaurant data from keyless, volunteer-run OpenStreetMap services.
    USE_MOCK_RESTAURANTS: booleanish.default(true),
    /** Comma-separated. Endpoints are tried in order when one is overloaded. */
    OVERPASS_URL: z
      .string()
      .default(
        "https://overpass-api.de/api/interpreter," +
          "https://overpass.kumi.systems/api/interpreter",
      ),
    /** How long a search is reused before re-fetching. Restaurants move slowly. */
    RESTAURANT_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
    NOMINATIM_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
    /** Nominatim's usage policy requires an identifying User-Agent. */
    OSM_USER_AGENT: z.string().default("Viand/0.1 (restaurant decision bot)"),
    /** Total budget for one upstream step, shared across failover endpoints. */
    OSM_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
    /** Raise for rural areas where the nearest options are further out. */
    OSM_MAX_QUERY_RADIUS_METRES: z.coerce.number().int().positive().default(3_000),
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

    if (env.USE_AI_INTERPRETER && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when USE_AI_INTERPRETER=true",
      });
    }

  });

export type Env = z.infer<typeof schema>;

export type MessagingProviderName = "mock" | "linq" | "telegram";

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
