import type { StrategySummary } from "./satisfaction";

export interface ReportContext {
  seed: number;
  groupCount: number;
  memberCount: number;
  catalogueSize: number;
  catalogueName: string;
  membersWithHardConstraint: number;
  skipped: string[];
}

function pct(value: number): string {
  return value.toFixed(3);
}

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

/**
 * A markdown table, plus the context needed to reproduce the run. The numbers
 * are meaningless without the seed and the catalogue, so they are printed
 * together and never separately.
 */
export function renderReport(summaries: readonly StrategySummary[], context: ReportContext): string {
  const headers = [
    "Strategy",
    "Min sat.",
    "Mean sat.",
    "Worst grp",
    "Violations",
    "Grps w/ viol.",
    "Answered",
    "Abstained",
  ];

  const rows = summaries.map((summary) => [
    summary.strategy,
    pct(summary.meanMinSatisfaction),
    pct(summary.meanSatisfaction),
    pct(summary.worstGroupMin),
    String(summary.violations),
    String(summary.groupsWithViolation),
    String(summary.answered),
    String(summary.abstained),
  ]);

  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );

  const line = (cells: string[]) =>
    `| ${cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join(" | ")} |`;
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

  const out: string[] = [];
  out.push("# Viand strategy evaluation");
  out.push("");
  out.push(
    `Seed \`${context.seed}\` · ${context.groupCount} groups · ${context.memberCount} members · ` +
      `${context.membersWithHardConstraint} with a hard constraint · ` +
      `catalogue \`${context.catalogueName}\` (${context.catalogueSize} restaurants)`,
  );
  out.push("");
  out.push(line(headers));
  out.push(divider);
  for (const row of rows) out.push(line(row));
  out.push("");
  out.push("**Min sat.** is the mean across groups of the *least satisfied* member — the fairness");
  out.push("number. **Mean sat.** averages every member. Both are computed from latent preference");
  out.push("vectors the strategies never see, so no strategy is graded on its own objective.");
  out.push("");
  out.push("**Violations** counts (group, member) pairs whose hard constraint the chosen restaurant");
  out.push("breaks. Satisfaction for such a member is 0, not merely low.");
  out.push("");
  out.push("**Abstained** groups are excluded from the satisfaction columns. Declining to answer is");
  out.push("a different outcome from answering badly, and averaging them together would hide it.");

  // An abstention caused by a failed model call is not the same finding as one
  // caused by a strategy correctly reporting that nothing fits. Without this
  // line a run against a dead API key reads as a well-behaved strategy.
  const failing = summaries.filter((summary) => summary.errors > 0);
  if (failing.length > 0) {
    out.push("");
    for (const summary of failing) {
      out.push(
        `> ⚠ **${summary.strategy}** had ${summary.errors} failed or unparseable ` +
          `call(s), counted as abstentions. Its columns above are not comparable.`,
      );
    }
  }

  if (context.skipped.length > 0) {
    out.push("");
    for (const note of context.skipped) out.push(`> _Skipped: ${note}_`);
  }

  return out.join("\n");
}
