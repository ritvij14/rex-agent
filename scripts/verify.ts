import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { isMain, ROOT, snapshot } from "./repo-check.ts";

export type Status = "PASSED" | "FAILED" | "BLOCKED" | "NOT_RUN";
export interface Step {
  id: string;
  command: string[];
}
export interface Result extends Step {
  status: Status;
  exitCode: number | null;
  durationMs: number;
  log: string | null;
}

export function summarize(results: Result[], unchanged = true): Status {
  if (!unchanged || results.length === 0) return "BLOCKED";
  if (results.some((result) => result.status === "FAILED")) return "FAILED";
  if (results.some((result) => result.status !== "PASSED")) return "BLOCKED";
  return "PASSED";
}

export function executeStep(step: Step, directory: string): Result {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(step.id) || !step.command.length)
    throw new Error("Invalid verification step.");
  const name = `${step.id}.log`;
  const file = openSync(join(directory, name), "wx", 0o600);
  const start = performance.now();
  try {
    const result = spawnSync(step.command[0]!, step.command.slice(1), {
      cwd: ROOT,
      stdio: ["ignore", file, file],
    });
    return {
      ...step,
      status:
        result.error || result.status === null
          ? "BLOCKED"
          : result.status === 0
            ? "PASSED"
            : "FAILED",
      exitCode: result.status,
      durationMs: Math.round(performance.now() - start),
      log: name,
    };
  } finally {
    closeSync(file);
  }
}

export function sourceDigest(): string {
  const { entries, problems } = snapshot(ROOT, "worktree");
  if (problems.length) throw new Error("Public source snapshot unavailable.");
  const hash = createHash("sha256");
  for (const [name, bytes] of entries.sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    hash.update(name).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

function doctor(docker: boolean): boolean {
  const tools = ["tsx", "typescript", "prettier"];
  const local =
    process.versions.node.split(".")[0] === "22" &&
    tools.every((tool) =>
      existsSync(join(ROOT, "node_modules", tool, "package.json")),
    );
  const engine = docker
    ? spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        stdio: "pipe",
        timeout: 10000,
      }).status === 0
    : true;
  console.log(`Node 22 and local tools: ${local ? "PASSED" : "BLOCKED"}`);
  if (docker) console.log(`Docker engine: ${engine ? "PASSED" : "BLOCKED"}`);
  return local && engine;
}

export function main(args: string[]): number {
  const mode = args[0];
  if (
    args.length !== 1 ||
    !["doctor", "checks", "sandbox", "full"].includes(mode!)
  ) {
    console.log("Usage: npm run verify -- doctor|checks|sandbox|full");
    return 1;
  }
  if (mode === "doctor") return doctor(true) ? 0 : 1;
  let directory: string | undefined;
  try {
    const local = join(ROOT, ".local");
    mkdirSync(local, { recursive: true, mode: 0o700 });
    if (lstatSync(local).isSymbolicLink())
      throw new Error("Evidence directory must not be a symlink.");
    const base = join(local, "verification");
    mkdirSync(base, { recursive: true, mode: 0o700 });
    if (lstatSync(base).isSymbolicLink())
      throw new Error("Evidence directory must not be a symlink.");
    directory = mkdtempSync(join(base, "run-"));
    const before = sourceDigest();
    const results: Result[] = [];
    const steps: Step[] = [];
    if (mode !== "sandbox") {
      for (const [id, script] of [
        ["types", "typecheck"],
        ["tests", "test"],
        ["privacy", "privacy:check"],
        ["format", "format:check"],
      ] as const) {
        steps.push({ id, command: ["npm", "run", script] });
      }
    }
    if (mode !== "checks")
      steps.push({
        id: "sandbox",
        command: ["npm", "run", "sandbox", "--", "check"],
      });
    const localReady = doctor(false);
    for (const step of steps) {
      if (!localReady || (step.id === "sandbox" && !doctor(true))) {
        results.push({
          ...step,
          status: "BLOCKED",
          exitCode: null,
          durationMs: 0,
          log: null,
        });
      } else results.push(executeStep(step, directory));
      console.log(`${step.id}: ${results.at(-1)!.status}`);
    }
    const after = sourceDigest();
    const status = summarize(results, before === after);
    const report = {
      scope: mode,
      status,
      sourceBefore: before,
      sourceAfter: after,
      sourceUnchanged: before === after,
      node: process.versions.node,
      results,
      notVerified: [
        ...(mode === "checks" ? ["Installed container acceptance"] : []),
        ...(mode === "sandbox" ? ["Repository source checks"] : []),
        "Live provider compatibility and model quality",
        "Task-specific exploratory QA and test sensitivity",
      ],
    };
    writeFileSync(
      join(directory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Selected baseline: ${status}`);
    console.log(`Evidence: ${relative(ROOT, directory)}/report.json`);
    return status === "PASSED" ? 0 : 1;
  } catch {
    if (directory && !existsSync(join(directory, "report.json"))) {
      try {
        writeFileSync(
          join(directory, "report.json"),
          `${JSON.stringify(
            {
              scope: mode,
              status: "BLOCKED",
              results: [],
              notVerified: [
                "Verification could not complete; no passing baseline established.",
              ],
            },
            null,
            2,
          )}\n`,
          { flag: "wx", mode: 0o600 },
        );
        console.log(`Evidence: ${relative(ROOT, directory)}/report.json`);
      } catch {
        console.error("BLOCKED: evidence could not be retained.");
      }
    }
    console.error(
      "BLOCKED: verification could not finish; no private details printed.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
