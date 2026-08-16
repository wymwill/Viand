import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOCK_RESTAURANTS } from "@/domain/restaurants/mock-data";
import { recommend } from "@/domain/recommendations/select";
import { preference } from "../helpers/factories";

/**
 * The determinism invariant for the recommendation path.
 *
 * The intent behind "zeroing every model weight reproduces deterministic
 * behaviour exactly" is that no inference can move a recommendation. In this
 * codebase there is no weight to zero, because there is no model in the
 * recommender at all — the only model touchpoint is the interpreter, which
 * turns a sentence into a `Command` and never reaches ranking.
 *
 * A test that zeroed a weight would therefore be testing nothing. What is
 * worth pinning is the stronger property that makes such a weight impossible
 * to add by accident: the recommendation path is a pure function of its
 * arguments, and nothing model-shaped or environment-shaped is even reachable
 * from it. That is what the import walk below asserts.
 *
 * If a reranking layer is ever added, this test should be replaced by one that
 * pins its weight-zero behaviour against the deterministic order.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ENTRY = join(SRC, "domain/recommendations/select.ts");

/** Bare specifiers the pure domain is allowed to depend on. */
const ALLOWED_PACKAGES = new Set(["zod"]);

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // Covers `import ... from "x"`, `export ... from "x"`, and `import("x")`.
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else return null; // bare package specifier

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        if (readFileSync(candidate, "utf8") !== undefined) return candidate;
      } catch {
        // A directory, not a file. Fall through to the next candidate.
      }
    }
  }
  return null;
}

/** Every file transitively reachable from the recommendation entry point. */
function reachableFiles(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved == null) {
        if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
        continue;
      }
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }

  return { files: [...seen], packages: [...packages] };
}

describe("recommendation path purity", () => {
  const { files, packages } = reachableFiles(ENTRY);

  it("reaches a non-trivial part of the domain", () => {
    // Guards the walker itself: a resolver bug that found nothing would make
    // every assertion below pass vacuously.
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.some((file) => file.endsWith("scoring.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("constraints.ts"))).toBe(true);
  });

  it("never leaves src/domain", () => {
    // src/lib is where I/O lives: model clients, HTTP, the store, the env
    // schema. If ranking could reach it, ranking could become non-deterministic
    // without any signature changing.
    const escapees = files
      .filter((file) => !file.startsWith(join(SRC, "domain")))
      .map((file) => relative(SRC, file));
    expect(escapees).toEqual([]);
  });

  it("depends on no inference package", () => {
    const disallowed = packages.filter((name) => !ALLOWED_PACKAGES.has(name));
    expect(disallowed).toEqual([]);
    expect(packages).not.toContain("@anthropic-ai/sdk");
  });

  it("reads no environment variable and no clock or randomness", () => {
    // A weight read from the environment, a Date.now() tiebreak, or a
    // Math.random() shuffle would each break reproducibility just as
    // thoroughly as a model call.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of ["process.env", "Math.random", "Date.now", "new Date("]) {
        if (source.includes(forbidden)) offenders.push(`${relative(SRC, file)}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("returns identical results across repeated calls", () => {
    const group = [
      preference({ preferredCuisines: ["mexican"], maxPriceLevel: 2 }),
      preference({ dietary: ["vegetarian"] }),
      preference({ noPreference: true }),
    ];
    const first = recommend(MOCK_RESTAURANTS, group);
    const second = recommend(MOCK_RESTAURANTS, group);
    expect(second).toEqual(first);
  });

  it("is unaffected by model configuration in the environment", () => {
    const group = [preference({ preferredCuisines: ["korean"] }), preference({ maxDistanceMiles: 2 })];
    const before = recommend(MOCK_RESTAURANTS, group);

    const saved = { ...process.env };
    try {
      process.env.USE_AI_INTERPRETER = "true";
      process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
      process.env.AI_INTERPRETER_MODEL = "some-other-model";
      expect(recommend(MOCK_RESTAURANTS, group)).toEqual(before);
    } finally {
      process.env = saved;
    }
  });
});
