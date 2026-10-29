import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseProfileArguments,
  parseProfileRequest,
  validateProfileId,
} from "@rex/profiles";

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

export const parseRexInput = parseProfileArguments;

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
  extraVolumes?: string[];
  extraEnv?: string[];
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
    ...(options.extraEnv ?? []),
    ...(options.extraVolumes ?? []),
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
  modelOverride?: string;
  command?: string[];
  // Remote MCP connectors for this launch only. The launcher reads URL/header/env
  // NAMES from the definitions snapshot data the caller supplies; the values are
  // never embedded here. Credential values are passed only to the connector
  // container, read from the launcher's own environment by name.
  connectors?: {
    endpoints: {
      id: string;
      url: string;
      header?: string;
      env?: string;
      caEnv?: string;
      privateNetwork?: boolean;
    }[];
    internal?: boolean;
  };
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
    const connectorName = `${options.project}-rex-connector-${options.profile}`;
    const connectorNetwork = `${projectNetwork(options.project, options.profile)}`;
    const connectorSockets = `${volumes.workspace}-connector-sockets`;
    let connectorStarted = false;
    let connectorNetworkOwned = false;
    if (options.connectors?.endpoints.length) {
      const endpoints = options.connectors.endpoints.map((endpoint) => ({
        socket: `/sockets/${endpoint.id}.sock`,
        url: endpoint.url,
        ...(endpoint.header && endpoint.env
          ? { header: endpoint.header, env: endpoint.env }
          : {}),
        ...(endpoint.caEnv ? { caEnv: endpoint.caEnv } : {}),
        privateNetwork: endpoint.privateNetwork === true,
      }));
      if (
        docker([
          "network",
          "inspect",
          "--format",
          "{{.Name}}",
          connectorNetwork,
        ]).status !== 0
      ) {
        requireSuccess(
          docker([
            "network",
            "create",
            ...(options.connectors.internal ? ["--internal"] : []),
            connectorNetwork,
          ]),
        );
      }
      try {
        requireSuccess(docker(["volume", "create", connectorSockets]));
        const specInput = JSON.stringify({ endpoints });
        const specWritten = docker(
          [
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
            "--interactive",
            "-v",
            `${connectorSockets}:/sockets`,
            "--entrypoint",
            "node",
            IMAGE,
            "-e",
            'process.stdin.isTTY ? process.exit(1) : require("node:fs").writeFileSync("/sockets/connectors.json", require("node:fs").readFileSync(0));',
          ],
          specInput,
        );
        if (specWritten.status !== 0)
          throw new Error("Connector specification could not be prepared.");
        const envFlags = endpoints.flatMap((endpoint) => [
          ...(endpoint.env ? ["--env", endpoint.env] : []),
          ...(endpoint.caEnv ? ["--env", endpoint.caEnv] : []),
        ]);
        // The spec is written as root into the volume; the connector's own
        // user must then own the directory to create unix sockets.
        requireSuccess(
          docker([
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            "0:0",
            "--cap-add",
            "CHOWN",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "-v",
            `${connectorSockets}:/sockets`,
            "--entrypoint",
            "sh",
            IMAGE,
            "-c",
            "chown -R 1000:1000 /sockets",
          ]),
        );
        requireSuccess(
          docker([
            "run",
            ...HELPER_LIMITS,
            "--name",
            connectorName,
            "--detach",
            "--network",
            connectorNetwork,
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--user",
            "1000:1000",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=16777216,uid=1000,gid=1000",
            "-v",
            `${connectorSockets}:/sockets:rw`,
            ...envFlags,
            "--entrypoint",
            "node",
            IMAGE,
            ...NODE.slice(1),
            "/opt/rex/connector.ts",
            "/sockets/connectors.json",
          ]),
        );
        connectorStarted = true;
        for (
          let attempt = 0;
          attempt < 50 &&
          docker([
            "run",
            "--rm",
            "--network",
            "none",
            ...HELPER_LIMITS.slice(1),
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--log-driver",
            "none",
            "--entrypoint",
            "node",
            "-v",
            `${connectorSockets}:/sockets:ro`,
            IMAGE,
            "-e",
            'const f=require("node:fs");process.exit(f.readdirSync("/sockets").filter((n)=>n.endsWith(".sock")).length===process.argv[1]?0:1)',
            String(endpoints.length),
          ]).status !== 0;
          attempt++
        ) {
          spawnSync("sleep", ["0.2"]);
        }
      } catch (error) {
        cleanupConnector(
          connectorName,
          connectorNetwork,
          connectorSockets,
          connectorNetworkOwned,
        );
        throw error;
      }
    }
    try {
      const args = workerDockerArgs({
        ...options,
        image: IMAGE,
        volumes,
        name,
        ...(connectorStarted
          ? {
              extraVolumes: [
                "-v",
                `${connectorSockets}:/run/connectors:ro,nocopy`,
              ],
            }
          : {}),
      });

      if (options.newSession && !options.command) args.push("--new-session");
      if (options.maintain && !options.command) args.push("--maintain");
      if (options.modelOverride !== undefined && !options.command)
        args.push("--model", options.modelOverride);
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
      if (connectorStarted)
        cleanupConnector(
          connectorName,
          connectorNetwork,
          connectorSockets,
          connectorNetworkOwned,
        );
    }
  });
}

function projectNetwork(project: string, profile: string) {
  // Docker network names are limited to 64 characters; the per-profile suffix
  // is a short digest, not a raw profile ID.
  const digest = createHash("sha256")
    .update(`${project}:${profile}`)
    .digest("hex")
    .slice(0, 8);
  return `${project.slice(0, 45)}-rc-${digest}`;
}

function cleanupConnector(
  name: string,
  network: string,
  sockets: string,
  owned = true,
) {
  const remains = docker([
    "container",
    "inspect",
    "--format",
    "{{.State.Running}}",
    name,
  ]);
  if (remains.status === 0) requireSuccess(docker(["rm", "-f", name]));
  if (
    docker(["volume", "inspect", "--format", "{{.Name}}", sockets]).status === 0
  )
    requireSuccess(docker(["volume", "rm", sockets]));
  if (
    owned &&
    docker(["network", "inspect", "--format", "{{.Name}}", network]).status ===
      0
  )
    requireSuccess(docker(["network", "rm", network]));
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
