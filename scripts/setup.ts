import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { git, isMain, ROOT } from "./repo-check.ts";

export const VERSION = "8.30.1";
const CHECKSUMS: Record<string, string> = {
  "darwin-arm64":
    "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  "darwin-x64":
    "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  "linux-arm64":
    "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  "linux-x64":
    "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
};

export function verifyArchive(archive: Buffer, checksum: string): void {
  if (createHash("sha256").update(archive).digest("hex") !== checksum) {
    throw new Error("Scanner checksum mismatch.");
  }
}

export async function setup(root = ROOT): Promise<void> {
  const system = platform();
  const architecture = arch();
  const checksum = CHECKSUMS[`${system}-${architecture}`];
  if (!checksum) {
    throw new Error("Unsupported platform: use macOS/Linux on ARM64 or x64.");
  }
  const target = join(root, ".tools/gitleaks");
  if (!existsSync(target)) {
    const name = `gitleaks_${VERSION}_${system}_${architecture}.tar.gz`;
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error("Scanner download failed.");
    const archive = Buffer.from(await response.arrayBuffer());
    verifyArchive(archive, checksum);
    const directory = mkdtempSync(join(tmpdir(), "rex-install-"));
    try {
      const archivePath = join(directory, "scanner.tar.gz");
      writeFileSync(archivePath, archive);
      // Stream only the verified named member, never extract paths onto the host.
      const binary = spawnSync("tar", ["-xzOf", archivePath, "gitleaks"], {
        maxBuffer: 64 * 1024 * 1024,
      });
      if (binary.error || binary.status !== 0 || !binary.stdout.length) {
        throw new Error(
          "Could not read scanner archive. Check that tar is installed.",
        );
      }
      mkdirSync(join(root, ".tools"), { recursive: true });
      writeFileSync(target, binary.stdout, { mode: 0o755 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const version = spawnSync(target, ["version"], { encoding: "utf8" });
  if (
    version.error ||
    version.status !== 0 ||
    version.stdout.trim() !== VERSION
  ) {
    throw new Error(
      "Wrong or unusable local scanner; review .tools/gitleaks before rerunning setup.",
    );
  }
  const configured = spawnSync(
    "git",
    ["-C", root, "config", "--get", "core.hooksPath"],
    { encoding: "utf8" },
  );
  if (
    configured.error ||
    (configured.status !== 0 && configured.status !== 1)
  ) {
    throw new Error("Could not inspect configured hooks.");
  }
  const current = configured.stdout.trim();
  if (current && current !== ".githooks") {
    throw new Error(
      "A different hooksPath is configured. Review it before installing Rex hooks.",
    );
  }
  for (const name of readdirSync(join(root, ".githooks"))) {
    chmodSync(join(root, ".githooks", name), 0o755);
  }
  git(root, "config", "--local", "core.hooksPath", ".githooks");
  console.log(
    `Installed Gitleaks ${VERSION} and local Git hooks. No credentials or runtime settings read.`,
  );
}

if (isMain(import.meta.url)) {
  try {
    await setup();
  } catch {
    console.log(
      "BLOCKED: setup could not finish. Check platform, network, tar, scanner version, and existing hooks configuration. No raw diagnostic content printed.",
    );
    process.exitCode = 1;
  }
}
