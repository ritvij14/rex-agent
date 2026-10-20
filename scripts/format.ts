import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { check, isMain, ROOT, snapshot } from "./repo-check.ts";

export function main(args: string[]): number {
  if (args.length !== 1 || !["--check", "--write"].includes(args[0]!)) {
    console.log("Usage: format.ts --check|--write");
    return 1;
  }
  try {
    if (!check(ROOT, "worktree", true)) return 1;
    const paths = snapshot(ROOT, "worktree").entries.map(([name]) => name);
    const executable = join(ROOT, "node_modules/.bin/prettier");
    if (!existsSync(executable)) {
      console.log("BLOCKED: formatter missing; run npm ci first.");
      return 1;
    }
    const result = spawnSync(
      executable,
      [args[0]!, "--ignore-unknown", "--", ...paths],
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    );
    return result.error || result.status !== 0 ? 1 : 0;
  } catch {
    console.log(
      "BLOCKED: formatting could not finish; no raw diagnostic content printed.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
