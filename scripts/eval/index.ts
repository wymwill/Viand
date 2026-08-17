import { MOCK_RESTAURANTS } from "@/domain/restaurants/mock-data";
import type { Restaurant } from "@/domain/restaurants/provider";
import { generateCatalogue } from "./catalogue";
import { generateGroups, type EvalGroup } from "./generate";
import { renderReport } from "./report";
import { Rng, digest } from "./rng";
import { evaluateChoice, summarise, type GroupOutcome, type StrategySummary } from "./satisfaction";
import { averageStrategy } from "./strategies/average";
import { deterministicStrategy } from "./strategies/deterministic";
import {
  DEFAULT_MODEL_OPTIONS,
  modelStrategyAvailable,
  runModelStrategy,
} from "./strategies/model";
import { resolveModelClient } from "./strategies/model-client";

/**
 * `npm run eval`
 *
 * Builds a seeded synthetic corpus, runs three strategies over the same
 * candidate set, and prints a markdown table.
 *
 * Flags:
 *   --seed=N            corpus seed (default 20260815)
 *   --groups=N          number of groups (default 50)
 *   --catalogue=NAME    synthetic | mock (default synthetic)
 *   --catalogue-size=N  synthetic catalogue size (default 60)
 *   --strategies=a,b,c  which to run (default all available)
 *   --concurrency=N     model calls in flight for (b) (default 2)
 *   --model=NAME        model for (b); provider follows the credential present
 *   --json              emit JSON instead of the markdown table
 */

export const DEFAULT_SEED = 20260815;
export const DEFAULT_GROUP_COUNT = 50;
export const DEFAULT_CATALOGUE_SIZE = 60;

interface Options {
  seed: number;
  groupCount: number;
  catalogue: "synthetic" | "mock";
  catalogueSize: number;
  strategies: Set<string>;
  /** Model calls in flight. Lower it to fit inside a tight provider quota. */
  concurrency: number;
  /** Overrides the provider's default model. Free-tier quota is per model. */
  model: string | undefined;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seed: DEFAULT_SEED,
    groupCount: DEFAULT_GROUP_COUNT,
    catalogue: "synthetic",
    catalogueSize: DEFAULT_CATALOGUE_SIZE,
    strategies: new Set(["a", "b", "c"]),
    concurrency: DEFAULT_MODEL_OPTIONS.concurrency,
    model: undefined,
    json: false,
  };

  for (const arg of argv) {
    const [flag, rawValue] = arg.split("=");
    const value = rawValue ?? "";

    switch (flag) {
      case "--seed":
        options.seed = Number(value) || DEFAULT_SEED;
        break;
      case "--groups":
        options.groupCount = Number(value) || DEFAULT_GROUP_COUNT;
        break;
      case "--catalogue":
        options.catalogue = value === "mock" ? "mock" : "synthetic";
        break;
      case "--catalogue-size":
        options.catalogueSize = Number(value) || DEFAULT_CATALOGUE_SIZE;
        break;
      case "--strategies":
        options.strategies = new Set(value.split(",").map((entry) => entry.trim().toLowerCase()));
        break;
      case "--concurrency":
        options.concurrency = Math.max(1, Number(value) || DEFAULT_MODEL_OPTIONS.concurrency);
        break;
      case "--model":
        options.model = value || undefined;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        break;
    }
  }

  return options;
}

/**
 * The corpus. One `Rng` drawn in a fixed order — catalogue first, then groups —
 * so the whole benchmark is a pure function of the seed.
 */
export function buildCorpus(options: {
  seed: number;
  groupCount: number;
  catalogue: "synthetic" | "mock";
  catalogueSize: number;
}): { catalogue: Restaurant[]; groups: EvalGroup[] } {
  const rng = new Rng(options.seed);
  const catalogue =
    options.catalogue === "mock"
      ? [...MOCK_RESTAURANTS]
      : generateCatalogue(rng, options.catalogueSize);
  const groups = generateGroups(rng, { seed: options.seed, groupCount: options.groupCount });
  return { catalogue, groups };
}

/** Stable digest of a corpus, for the reproducibility test. */
export function corpusDigest(corpus: { catalogue: Restaurant[]; groups: EvalGroup[] }): string {
  return digest({
    catalogue: corpus.catalogue.map((restaurant) => restaurant.id + restaurant.cuisine),
    groups: corpus.groups.map((group) => ({
      id: group.id,
      members: group.members.map((member) => ({
        sentence: member.sentence,
        constraint: member.latent.hardConstraint,
        ideal: member.latent.idealPriceLevel,
        tolerance: member.latent.distanceTolerance,
      })),
    })),
  });
}

function runSync(
  label: string,
  groups: readonly EvalGroup[],
  catalogue: readonly Restaurant[],
  strategy: (group: EvalGroup, catalogue: readonly Restaurant[]) => Restaurant | null,
): StrategySummary {
  const outcomes: GroupOutcome[] = groups.map((group) =>
    evaluateChoice(group, strategy(group, catalogue)),
  );
  return summarise(label, outcomes);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { catalogue, groups } = buildCorpus(options);

  const summaries: StrategySummary[] = [];
  const skipped: string[] = [];

  if (options.strategies.has("a")) {
    summaries.push(runSync("(a) naive averaging", groups, catalogue, averageStrategy));
  }

  if (options.strategies.has("b")) {
    if (modelStrategyAvailable()) {
      const { choices, errors, unavailable, label } = await runModelStrategy(
        groups,
        catalogue,
        { ...DEFAULT_MODEL_OPTIONS, concurrency: options.concurrency },
        resolveModelClient(options.model),
      );
      const outcomes = groups.map((group, index) => evaluateChoice(group, choices[index] ?? null));
      // The model is named in the label: a fairness score is not comparable
      // across models, so an unattributed row would be unreadable later.
      summaries.push(summarise(`(b) unstructured model [${label}]`, outcomes, errors));
      if (unavailable > 0) {
        // Distinct from an abstention on purpose. These groups were never put
        // to the model, so the row understates it by an unknown amount and
        // must not be published as a measurement of it.
        skipped.push(
          `(b) NOT PUBLISHABLE — ${unavailable} of ${groups.length} call(s) never reached ` +
            `${label} (quota, 5xx, or timeout). Re-run with quota before quoting this row.`,
        );
      }
    } else {
      skipped.push("(b) unstructured model — no GEMINI_API_KEY or ANTHROPIC_API_KEY set");
    }
  }

  if (options.strategies.has("c")) {
    summaries.push(runSync("(c) deterministic scorer", groups, catalogue, deterministicStrategy));
  }

  const memberCount = groups.reduce((sum, group) => sum + group.members.length, 0);
  const membersWithHardConstraint = groups.reduce(
    (sum, group) =>
      sum + group.members.filter((member) => member.latent.hardConstraint != null).length,
    0,
  );

  const context = {
    seed: options.seed,
    groupCount: groups.length,
    memberCount,
    catalogueSize: catalogue.length,
    catalogueName: options.catalogue,
    membersWithHardConstraint,
    skipped,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ context, summaries }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(summaries, context)}\n`);
  }
}

// Only run when invoked as a script; the module is also imported by tests.
const invokedDirectly =
  process.argv[1] != null && process.argv[1].includes("scripts/eval/index");

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`eval failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
