import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MAX_BYTES = 512 * 1024;
export type Entry = [name: string, data: Buffer];
export type Problem = [name: string, issue: string];
export type Mode = "worktree" | "index" | "commit";

const ROOT_FILES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierrc.json",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.base.json",
]);
const PUBLIC_DIRS = new Set([
  ".github",
  ".githooks",
  "docs",
  "lab",
  "packages",
  "patches",
  "scripts",
  "tests",
]);
const PRIVATE_PARTS = new Set([
  ".local",
  "private",
  ".rex",
  ".pi",
  ".hermes",
  ".ssh",
  ".aws",
  ".config",
  "data",
  "memories",
  "sessions",
  "transcripts",
  "node_modules",
  ".tools",
  "dist",
  "coverage",
  "__pycache__",
  ".venv",
]);
const PRIVATE_NAMES = new Set([
  "auth.json",
  "models.json",
  "credentials.json",
  "settings.local.json",
]);
const OLD_NAMES = new Set([
  "chatgpt-plan.md",
  "detailed-diagram.md",
  "quota-research.md",
  "agent-memory-deep-research.md",
  "agent-memory-research-notes.md",
  "live-memory-gbrain-anythingllm.md",
  "memory-research.md",
  "rex-pi-direction-conversation.md",
  "memory-site",
]);
const PRIVATE_SUFFIXES = new Set([
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".jsonl",
  ".log",
  ".bak",
  ".orig",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".png",
  ".jpg",
  ".mp4",
]);
const PUBLIC_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "users.noreply.github.com",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function isMain(url: string): boolean {
  return (
    !!process.argv[1] &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(url))
  );
}

export function git(root: string, ...args: string[]): Buffer {
  const result = spawnSync("git", ["-C", root, ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Git inspection could not finish.");
  }
  return result.stdout;
}

export function pathProblems(name: string): string[] {
  const parts = name.split("/");
  if (
    !name ||
    name.startsWith("/") ||
    parts.includes("..") ||
    name.includes("\\")
  ) {
    return ["unsafe path"];
  }
  const issues: string[] = [];
  if (/[\s\p{Cc}]/u.test(name)) {
    issues.push("whitespace or control character in path");
  }
  const skillDocument =
    name === ".agents/AGENTS.md" ||
    name === ".agents/pstack-license.txt" ||
    /^\.agents\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:SKILL\.md|(?:features|references)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/.test(
      name,
    );
  if (
    !skillDocument &&
    ((parts.length === 1 && !ROOT_FILES.has(name)) ||
      (parts.length > 1 && !PUBLIC_DIRS.has(parts[0]!)))
  ) {
    issues.push("path not approved for publication");
  }
  if (
    parts.some(
      (part) =>
        PRIVATE_PARTS.has(part.toLowerCase()) ||
        OLD_NAMES.has(part.toLowerCase()),
    )
  ) {
    issues.push("local-only or previous-work path");
  }
  const base = parts.at(-1)!;
  if (
    PRIVATE_NAMES.has(base.toLowerCase()) ||
    PRIVATE_SUFFIXES.has(extname(base).toLowerCase())
  ) {
    issues.push("private data, recording, or binary attachment");
  }
  if (base.startsWith(".env") && !base.endsWith(".env.example")) {
    issues.push("real environment file");
  }
  if (base.startsWith("service-account")) {
    issues.push("service-account file");
  }
  return issues;
}

export function textProblems(data: Buffer, terms: string[] = []): string[] {
  if (data.length > MAX_BYTES) return ["file exceeds public review size limit"];
  let text: string;
  try {
    text = decoder.decode(data);
  } catch {
    return ["non-UTF-8 or binary file"];
  }
  if (text.includes("\0")) return ["binary file"];
  const issues: string[] = [];
  if (/\/(?:Users|home)\/[^\s/<>"']+/.test(text)) {
    issues.push("personal absolute home path");
  }
  if (/(?<![\w])\d{17,20}(?![\w])/.test(text)) {
    issues.push("possible chat/account ID; use named synthetic fixtures");
  }
  for (const match of text.matchAll(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  )) {
    if (!PUBLIC_EMAIL_DOMAINS.has(match[0].split("@")[1]!.toLowerCase())) {
      issues.push("non-example email address");
      break;
    }
  }
  if (terms.some((term) => text.toLowerCase().includes(term.toLowerCase()))) {
    issues.push("local private term");
  }
  return issues;
}

export function privateTerms(root: string): string[] {
  const path = join(root, ".local/privacy-terms.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.trim());
}

export function snapshot(
  root: string,
  mode: Mode,
  revision = "HEAD",
): { entries: Entry[]; problems: Problem[] } {
  const entries: Entry[] = [];
  const problems: Problem[] = [];
  if (mode === "worktree") {
    const names = decoder
      .decode(
        git(
          root,
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ),
      )
      .split("\0");
    for (const name of [...new Set(names)].filter(Boolean).sort()) {
      const path = join(root, name);
      let info;
      try {
        info = lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const issues = pathProblems(name);
      if (issues.length) {
        problems.push(...issues.map((issue): Problem => [name, issue]));
        continue;
      }
      const parts = name.split("/");
      // Do not follow an ancestor link into private host files.
      if (
        parts.some((_, i) =>
          lstatSync(join(root, ...parts.slice(0, i + 1))).isSymbolicLink(),
        )
      ) {
        problems.push([name, "symbolic link is not publishable"]);
        continue;
      }
      if (!info.isFile() || info.size > MAX_BYTES) {
        problems.push([name, "not a regular small text file"]);
        continue;
      }
      entries.push([name, readFileSync(path)]);
    }
  } else {
    const raw =
      mode === "index"
        ? git(root, "ls-files", "--stage", "-z")
        : git(root, "ls-tree", "-rz", revision);
    for (const record of decoder.decode(raw).split("\0").filter(Boolean)) {
      const tab = record.indexOf("\t");
      if (tab < 0) throw new Error("Invalid Git entry.");
      const name = record.slice(tab + 1);
      const [fileMode, oidOrType, stageOrOid] = record.slice(0, tab).split(" ");
      const oid = mode === "index" ? oidOrType : stageOrOid;
      if (!oid) throw new Error("Invalid Git object.");
      const issues = pathProblems(name);
      if (fileMode !== "100644" && fileMode !== "100755") {
        issues.push("link or submodule is not publishable");
      }
      if (mode === "index" && stageOrOid !== "0") {
        issues.push("unresolved merge entry");
      }
      if (issues.length) {
        problems.push(...issues.map((issue): Problem => [name, issue]));
        continue;
      }
      if (Number(git(root, "cat-file", "-s", oid).toString()) > MAX_BYTES) {
        problems.push([name, "file exceeds public review size limit"]);
        continue;
      }
      entries.push([name, git(root, "cat-file", "blob", oid)]);
    }
  }
  return { entries, problems };
}

export function scanSecrets(root: string, entries: Entry[]): boolean {
  const executable = join(root, ".tools/gitleaks");
  if (!existsSync(executable) || !statSync(executable).isFile()) {
    console.log("BLOCKED: pinned secret scanner missing; run npm run setup.");
    return false;
  }
  const directory = mkdtempSync(join(tmpdir(), "rex-scan-"));
  try {
    for (const [name, data] of entries) {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    }
    const result = spawnSync(
      executable,
      ["dir", directory, "--redact=100", "--no-banner", "--log-level", "error"],
      {
        cwd: directory,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith("GITLEAKS_"),
          ),
        ),
      },
    );
    if (result.error || result.status !== 0) {
      console.log(
        "BLOCKED: secret scanner found a potential secret or could not finish. Matched content suppressed.",
      );
      return false;
    }
    return true;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function check(
  root: string,
  mode: Mode,
  secrets = false,
  revision = "HEAD",
): boolean {
  const { entries, problems } = snapshot(root, mode, revision);
  const terms = privateTerms(root);
  for (const [name, data] of entries) {
    for (const issue of [
      ...textProblems(data, terms),
      ...textProblems(Buffer.from(name), terms),
    ]) {
      problems.push([name, issue]);
    }
  }
  // Filenames can themselves contain private content.
  for (const [, issue] of problems) {
    console.log(`BLOCKED: ${issue} (path and content suppressed).`);
  }
  if (problems.length || (secrets && !scanSecrets(root, entries))) return false;
  console.log(`PASS: ${entries.length} public files checked (${mode}).`);
  return true;
}

export function history(root: string, secrets = false): boolean {
  const commits = git(root, "rev-list", "--all")
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!commits.length) {
    console.log("BLOCKED: no commit history to check yet.");
    return false;
  }
  for (const commit of commits) {
    const identity = git(
      root,
      "show",
      "-s",
      "--format=%an%n%ae%n%cn%n%ce",
      commit,
    );
    if (secrets && !scanSecrets(root, [["git-identity.txt", identity]])) {
      return false;
    }
    const message = git(root, "show", "-s", "--format=%B", commit);
    if (textProblems(message, privateTerms(root)).length) {
      console.log(
        "BLOCKED: private content in commit message (content suppressed).",
      );
      return false;
    }
    if (secrets && !scanSecrets(root, [["commit-message.txt", message]]))
      return false;
    if (!check(root, "commit", secrets, commit)) return false;
  }
  console.log(
    `PASS: all ${commits.length} commits reachable from local refs checked.`,
  );
  return true;
}

export function main(args: string[]): number {
  const modes = ["--worktree", "--index", "--history"];
  if (
    args.filter((arg) => modes.includes(arg)).length !== 1 ||
    args.some((arg) => ![...modes, "--secrets", "--list"].includes(arg))
  ) {
    console.log(
      "Usage: repo-check.ts --worktree|--index|--history [--secrets] [--list]",
    );
    return 1;
  }
  try {
    const secrets = args.includes("--secrets");
    const mode = args.includes("--index") ? "index" : "worktree";
    const passed = args.includes("--history")
      ? history(ROOT, secrets)
      : check(ROOT, mode, secrets);
    if (passed && args.includes("--list") && !args.includes("--history")) {
      for (const [name] of snapshot(ROOT, mode).entries) console.log(name);
    }
    return passed ? 0 : 1;
  } catch {
    console.log(
      "BLOCKED: repository inspection could not finish; no raw diagnostic content printed.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
