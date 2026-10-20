import { readFileSync } from "node:fs";
import {
  git,
  isMain,
  privateTerms,
  ROOT,
  scanSecrets,
  textProblems,
} from "./repo-check.ts";

export function identityOk(root = ROOT): boolean {
  for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    const identity = git(root, "var", variable).toString();
    if (!scanSecrets(root, [["git-identity.txt", Buffer.from(identity)]])) {
      return false;
    }
  }
  return true;
}

export function main(args: string[]): number {
  try {
    if (args.length > 1 || !identityOk()) return 1;
    if (args[0]) {
      const message = readFileSync(args[0]);
      if (textProblems(message, privateTerms(ROOT)).length) {
        console.log(
          "BLOCKED: private content in commit message (content suppressed).",
        );
        return 1;
      }
      if (!scanSecrets(ROOT, [["commit-message.txt", message]])) return 1;
    }
    return 0;
  } catch {
    console.log(
      "BLOCKED: commit inspection could not finish; no raw diagnostic content printed.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
