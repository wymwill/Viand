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

    LINQ_API_KEY: z.string().optional(),
    LINQ_PHONE_NUMBER: e164.optional(),
    LINQ_WEBHOOK_SECRET: z.string().optional(),
    LINQ_WEBHOOK_VERSION: z.string().default("2026-02-03"),
    LINQ_API_BASE_URL: z.string().url().optional(),

    PHONE_NUMBER_DISPLAY: z.string().default("(555) 555-0123"),
    PHONE_NUMBER_E164: e164.default("+15555550123"),

    USE_MOCK_LINQ: booleanish.default(true),
  })
  .superRefine((env, ctx) => {
    // When the real Linq provider is selected, its credentials become required.
    if (!env.USE_MOCK_LINQ) {
      for (const key of ["LINQ_API_KEY", "LINQ_PHONE_NUMBER", "LINQ_WEBHOOK_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when USE_MOCK_LINQ=false`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof schema>;

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
