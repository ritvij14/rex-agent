import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { closeSync, openSync, readSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProfileRequest, validateProfileId } from "@rex/profiles";

export const NODE = [
  "node",
  "--import",
  "/opt/rex/node_modules/tsx/dist/loader.mjs",
];
export const IMAGE = "rex-terminal:local";
const HELPER_LIMITS = [
  "--init",
  "--cpus",
  "0.5",
  "--memory",
  "256m",
  "--memory-swap",
  "256m",
  "--pids-limit",
  "64",
];

export function parseRexInput(args: string[]) {
  const rest = [...args];
  let newSession = false;
  let maintain = false;
  while (rest[0]?.startsWith("--")) {
    if (rest[0] === "--new-session" && !newSession) newSession = true;
    else if (rest[0] === "--maintain" && !maintain) maintain = true;
    else throw new Error("Invalid profile arguments.");
    rest.shift();
  }
  if (rest.length > 1) throw new Error("Invalid profile arguments.");
  return { newSession, maintain, input: rest[0] ?? null };
}

export function readRexInput() {
  const buffer = Buffer.alloc(65537);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(0, buffer, length, buffer.length - length, null);
    if (!count) break;
    length += count;
  }
  if (length > 65536) throw new Error("Profile input too large.");
  return buffer.subarray(0, length).toString("utf8");
}

export function workerVolumes(project: string, profile: string) {
  validateProfileId(profile);
  if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(project))
    throw new Error("Invalid project.");
  const prefix = `${project}_rex-profile-${profile}`;
  return {
    workspace: `${prefix}-workspace`,
    state: `${prefix}-state`,
    proposals: `${prefix}-proposals`,
    defs: `${prefix}-defs`,
    socket: `${project}_inference-socket`,
  };
}

type Volumes = ReturnType<typeof workerVolumes>;
export function workerDockerArgs(options: {
  project: string;
  image: string;
  profile: string;
  volumes: Volumes;
  name: string;
  detached?: boolean;
  command?: string[];
}) {
  const { volumes } = options;
  validateProfileId(options.profile);
  return [
    "run",
    "--rm",
    "--interactive",
    "--name",
    options.name,
    "--label",
    `com.docker.compose.project=${options.project}`,
    ...(options.detached ? ["-d"] : []),
    "--network",
    "none",
    "--user",
    "1000:1000",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--init",
    "--pids-limit",
    "128",
    "--memory",
    "1g",
    "--memory-swap",
    "1g",
    "--cpus",
    "2",
    "--log-driver",
    "none",
    "--entrypoint",
    "/usr/bin/env",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=1000,gid=1000",
    "-v",
    `${volumes.workspace}:/workspace`,
    "-v",
    `${volumes.state}:/state`,
    "-v",
    `${volumes.proposals}:/proposals`,
    "-v",
    `${volumes.defs}:/profiles:ro,nocopy`,
    "-v",
    `${volumes.socket}:/run/rex:ro`,
    options.image,
    ...(options.command ?? [...NODE, "/opt/rex/runtime.ts", "worker"]),
  ];
}

export function docker(
  args: string[],
  input?: string,
): SpawnSyncReturns<string> {
  return spawnSync("docker", args, {
    encoding: "utf8",
    input,
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function requireSuccess(result: SpawnSyncReturns<string>) {
  if (result.error || result.status !== 0)
    throw new Error("Profile container operation failed.");
  return result.stdout.trim();
}

export function withProfileLock<T>(
  project: string,
  profile: string,
  work: () => T,
): T {
  workerVolumes(project, profile);
  const path = join(tmpdir(), `${project}-rex-${profile}.lock`);
  let handle: number;
  try {
    handle = openSync(path, "wx", 0o600);
  } catch {
    throw new Error("Profile is busy or its operator lock requires recovery.");
  }
  try {
    // Docker also reserves this name until the worker and its descendants exit.
    const exists = docker([
      "container",
      "inspect",
      "--format",
      "{{.State.Running}}",
      `${project}-rex-${profile}`,
    ]);
    if (exists.status === 0)
      throw new Error("Profile is busy or its worker requires recovery.");
    return work();
  } finally {
    closeSync(handle);
    unlinkSync(path);
  }
}

export function runProfileWorker(options: {
  project: string;
  profile: string;
  input?: string;
  newSession?: boolean;
  maintain?: boolean;
  command?: string[];
}) {
  validateProfileId(options.profile);
  if (!options.command) {
    const { profileId } = parseProfileRequest(options.input ?? "");
    if (profileId !== options.profile)
      throw new Error("Profile selector does not match the worker.");
  }
  return withProfileLock(options.project, options.profile, () => {
    const volumes = workerVolumes(options.project, options.profile);
    // Docker seeds a new master volume from the public image once; existing data is never replaced.
    requireSuccess(
      docker([
        "run",
        "--rm",
        ...HELPER_LIMITS,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--entrypoint",
        "node",
        "--log-driver",
        "none",
        "-v",
        `${options.project}_profile-definitions:/profiles:ro`,
        IMAGE,
        "-e",
        "process.exit(0)",
      ]),
    );
    const provisioned = docker([
      "run",
      "--rm",
      ...HELPER_LIMITS,
      "--network",
      "none",
      "--user",
      "0:0",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "CHOWN",
      "--security-opt",
      "no-new-privileges:true",
      "--entrypoint",
      "/usr/bin/env",
      "--log-driver",
      "none",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=67108864",
      "-v",
      `${options.project}_profile-definitions:/master:ro`,
      "-v",
      `${volumes.defs}:/snapshot`,
      "-v",
      `${volumes.workspace}:/workspace`,
      "-v",
      `${volumes.state}:/state`,
      "-v",
      `${volumes.proposals}:/proposals`,
      IMAGE,
      ...NODE,
      "/opt/rex/provision.ts",
      options.profile,
    ]);
    if (provisioned.status !== 0 || provisioned.error)
      throw new Error("Profile provisioning failed.", {
        cause: provisioned.stderr,
      });
    const name = `${options.project}-rex-${options.profile}`;
    try {
      const args = workerDockerArgs({
        ...options,
        image: IMAGE,
        volumes,
        name,
      });
      if (options.newSession && !options.command) args.push("--new-session");
      if (options.maintain && !options.command) args.push("--maintain");
      return docker(args, options.input);
    } finally {
      // A killed Docker client is not proof that its worker stopped.
      const remains = docker([
        "container",
        "inspect",
        "--format",
        "{{.State.Running}}",
        name,
      ]);
      if (remains.status === 0) requireSuccess(docker(["rm", "-f", name]));
    }
  });
}

export function operatorProposalVolume(
  project: string,
  action: "review" | "approve" | "review-update" | "approve-update",
  id: string,
) {
  validateProfileId(id);
  const origin = action.endsWith("update") ? id : "profile-builder";
  return workerVolumes(project, origin).proposals;
}

export function operatorProfileCommand(
  project: string,
  action: "review" | "approve" | "review-update" | "approve-update",
  id: string,
  digest?: string,
) {
  validateProfileId(id);
  const origin = action.endsWith("update") ? id : "profile-builder";
  return withProfileLock(project, origin, () =>
    docker([
      "run",
      "--rm",
      ...HELPER_LIMITS,
      "--network",
      "none",
      "--user",
      "0:0",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--log-driver",
      "none",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=67108864",
      "--entrypoint",
      "/usr/bin/env",
      "-v",
      `${project}_profile-definitions:/profiles`,
      "-v",
      `${operatorProposalVolume(project, action, id)}:/proposals:ro`,
      IMAGE,
      ...NODE,
      "/opt/rex/packages/pi-profiles/src/operator.ts",
      action,
      id,
      ...(digest ? [digest] : []),
    ]),
  );
}
