import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { modelConfiguration } from "../lab/terminal/configure.ts";
import { isMain, ROOT } from "./repo-check.ts";
import { parseProfileRequest, validateProfileId } from "@rex/profiles";
import {
  NODE,
  operatorExport,
  operatorImport,
  operatorInspect,
  operatorProfileCommand,
  parseRexInput,
  readRexInput,
  requireSuccess,
  runProfileWorker,
} from "./profile-worker.ts";
import {
  checkProfileAcceptance,
  cleanupProfileAcceptance,
} from "./profile-acceptance.ts";
export { parseRexInput, workerDockerArgs } from "./profile-worker.ts";

const PROJECT = "rex-terminal";
const LAB = join(ROOT, "lab/terminal");

function compose(
  project: string,
  checking: boolean,
  args: string[],
  capture = false,
): string {
  const files = ["-f", join(LAB, "compose.yaml")];
  if (checking) files.push("-f", join(LAB, "compose.check.yaml"));
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      "/dev/null",
      "--project-name",
      project,
      ...files,
      ...args,
    ],
    {
      cwd: LAB,
      env: {
        ...process.env,
        COMPOSE_DISABLE_ENV_FILE: "1",
        COMPOSE_PROFILES: "",
        ...(checking ? { REX_PROXY_API_KEY: "" } : {}),
      },
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("Docker command failed");
  return capture ? result.stdout.trim() : "";
}

function inspect(id: string, field: string): unknown {
  const result = spawnSync(
    "docker",
    ["inspect", "--format", `{{json .${field}}}`, id],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw new Error("Container inspection failed");
  return JSON.parse(result.stdout);
}

function check() {
  const project = `rex-terminal-check-${randomUUID()}`;
  const run = (...args: string[]) => compose(project, true, args);
  const exec = (...args: string[]) => run("exec", "-T", "sandbox", ...args);
  try {
    run("build", "sandbox");
    run("up", "-d", "--no-build", "--wait", "--wait-timeout", "90");
    for (const service of ["sandbox", "gateway", "fixture"]) {
      const id = compose(project, true, ["ps", "-q", service], true);
      const mounts = inspect(id, "Mounts") as {
        Type: string;
        Destination: string;
        RW: boolean;
      }[];
      assert.equal(
        mounts.some((mount) => mount.Type === "bind"),
        false,
      );
      assert.deepEqual(inspect(id, "NetworkSettings.Ports"), {});
      const host = inspect(id, "HostConfig") as {
        Privileged: boolean;
        ReadonlyRootfs: boolean;
        CapDrop: string[];
        SecurityOpt: string[];
        NetworkMode: string;
        PidsLimit: number;
      };
      assert.equal(host.Privileged, false);
      assert.equal(host.ReadonlyRootfs, true);
      assert.deepEqual(host.CapDrop, ["ALL"]);
      assert.equal(host.SecurityOpt.includes("no-new-privileges:true"), true);
      assert.equal(host.PidsLimit, service === "sandbox" ? 128 : 64);
      if (service === "sandbox") {
        assert.equal(host.NetworkMode, "none");
        assert.ok(
          !mounts.some(
            (mount) =>
              mount.Destination === "/profiles" ||
              mount.Destination === "/proposals",
          ),
        );
        assert.equal(
          mounts.find((mount) => mount.Destination === "/run/rex")?.RW,
          false,
        );
      }
    }
    run(
      "exec",
      "-T",
      "gateway",
      "node",
      "-e",
      "const a=require('node:assert/strict'),{spawnSync}=require('node:child_process');a.equal(spawnSync(process.execPath,['-e','']).status,0)",
    );
    exec(...NODE, "/opt/rex/verify.ts");
    exec(
      ...NODE,
      "/opt/rex/runtime.ts",
      "configure",
      "synthetic-model",
      "openai-completions",
    );
    assert.equal(
      compose(
        project,
        true,
        ["exec", "-T", "sandbox", "/usr/local/bin/pi", "--version"],
        true,
      ),
      "1.3.0",
    );
    const output = compose(
      project,
      true,
      [
        "exec",
        "-T",
        "sandbox",
        "/usr/local/bin/pi",
        "--print",
        "--no-tools",
        "--no-session",
        "Reply with synthetic.",
      ],
      true,
    );
    assert.match(output, /synthetic/);
    exec(
      "node",
      "-e",
      `const a=require('node:assert/strict'),{spawnSync}=require('node:child_process');
      const r=spawnSync(process.execPath,['--import','/opt/rex/node_modules/tsx/dist/loader.mjs','/opt/rex/packages/pi-profiles/src/cli.ts','profile: research\\nsynthetic-cap-free-response'],{encoding:'utf8'});
      a.equal(r.status,1,'shared baseline must reject the profile CLI');a.equal(r.stdout,'');`,
    );
    exec(...NODE, "/opt/rex/packages/pi-profiles/src/verify.ts", "responses");
    checkProfileAcceptance(project);
    run("stop", "gateway");
    exec(
      "node",
      "-e",
      "fetch('http://127.0.0.1:8317/v1/models').then(r=>{if(r.status!==502)process.exit(1)})",
    );
    run("up", "-d", "--wait", "gateway");
    exec(
      "node",
      "-e",
      "fetch('http://127.0.0.1:8317/v1/models').then(r=>{if(!r.ok)process.exit(1)})",
    );
    run("up", "-d", "--wait", "--force-recreate", "sandbox");

    exec(
      "node",
      "-e",
      "const a=require('node:assert/strict'),f=require('node:fs'); for(const p of ['/workspace/synthetic-check.txt','/state/synthetic-check.txt','/state/pi/models.json'])a.equal(f.existsSync(p),true);a.equal(f.existsSync('/tmp/synthetic-check.txt'),false)",
    );
    run("down", "--volumes");
    run("up", "-d", "--wait", "--no-build");
    exec(
      "node",
      "-e",
      "const a=require('node:assert/strict'),f=require('node:fs');for(const p of ['/workspace/synthetic-check.txt','/state/synthetic-check.txt','/state/pi/models.json'])a.equal(f.existsSync(p),false)",
    );
    console.log(
      "PASS: real containers, synthetic Pi/profile inference, operator approval, gateway recovery, persistent recreation, and clean reset. No live proxy or model used.",
    );
  } finally {
    cleanupProfileAcceptance(project);
    run("down", "--volumes");
  }
}

export function main(args: string[]): number {
  const [command, ...rest] = args;
  try {
    if (command === "check" && !rest.length) check();
    else if (command === "build" && !rest.length)
      compose(PROJECT, false, ["build", "sandbox"]);
    else if (command === "start" && !rest.length) {
      compose(PROJECT, false, ["build", "sandbox"]);
      compose(PROJECT, false, ["up", "-d", "--no-build", "--wait"]);
    } else if (command === "refresh" && !rest.length) {
      const running = compose(
        PROJECT,
        false,
        ["ps", "--status", "running", "--services"],
        true,
      ).split("\n");
      if (!running.includes("gateway"))
        throw new Error("Start the authenticated gateway first");
      compose(PROJECT, false, ["build", "sandbox"]);
      compose(PROJECT, false, [
        "up",
        "-d",
        "--no-build",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "sandbox",
      ]);
    } else if (command === "stop" && !rest.length)
      compose(PROJECT, false, ["down"]);
    else if (
      command === "reset" &&
      rest.length === 1 &&
      rest[0] === "--confirm"
    )
      compose(PROJECT, false, ["down", "--volumes"]);
    else if (command === "shell" && !rest.length)
      compose(PROJECT, false, ["exec", "sandbox", "bash"]);
    else if (command === "pi")
      compose(PROJECT, false, [
        "exec",
        "sandbox",
        "/usr/local/bin/pi",
        ...rest,
      ]);
    else if (command === "rex") {
      const { newSession, maintain, modelOverride, input } =
        parseRexInput(rest);
      const request = input ?? readRexInput();
      const { profileId } = parseProfileRequest(request);
      const result = runProfileWorker({
        project: PROJECT,
        profile: profileId,
        input: request,
        newSession,
        maintain,
        modelOverride,
      });
      if (result.status !== 0) {
        console.error(
          result.stderr.includes("Profile response was truncated")
            ? "Profile response was truncated at the provider output limit. Earlier tool actions may already have completed."
            : "Profile request failed; private diagnostics omitted.",
        );
        return 1;
      }
      process.stdout.write(result.stdout);
    } else if (
      ((command === "review-profile" || command === "review-update") &&
        rest.length === 1) ||
      ((command === "approve-profile" || command === "approve-update") &&
        rest.length === 2)
    ) {
      validateProfileId(rest[0]);
      if (
        (command === "approve-profile" || command === "approve-update") &&
        !/^[a-f0-9]{64}$/.test(rest[1]!)
      )
        throw new Error();
      const result = operatorProfileCommand(
        PROJECT,
        command === "review-profile"
          ? "review"
          : command === "review-update"
            ? "review-update"
            : command === "approve-profile"
              ? "approve"
              : "approve-update",
        rest[0]!,
        rest[1],
      );
      process.stdout.write(requireSuccess(result) + "\n");
    } else if (
      (command === "list-profiles" && !rest.length) ||
      ((command === "show-profile" ||
        command === "validate-profile" ||
        command === "effective-profile") &&
        rest.length === 1)
    ) {
      const id = rest[0];
      if (id !== undefined) validateProfileId(id);
      const action =
        command === "list-profiles"
          ? "list"
          : command === "show-profile"
            ? "show"
            : command === "validate-profile"
              ? "validate"
              : "effective";
      process.stdout.write(operatorInspect(PROJECT, action, id) + "\n");
    } else if (
      (command === "export-profiles" || command === "import-profiles") &&
      rest.length === 1
    ) {
      const archive = rest[0]!;
      if (
        !archive.trim() ||
        /\s|[\x00-\x1f]/.test(archive) ||
        archive.length > 512
      )
        throw new Error("Provide one plain archive path without whitespace.");
      if (command === "export-profiles") operatorExport(PROJECT, archive);
      else process.stdout.write(operatorImport(PROJECT, archive) + "\n");
    } else if (command === "configure" && rest.length === 2) {
      modelConfiguration(rest[0]!, rest[1]!);
      compose(PROJECT, false, [
        "exec",
        "-T",
        "sandbox",
        ...NODE,
        "/opt/rex/runtime.ts",
        "configure",
        ...rest,
      ]);
    } else {
      console.log(
        "Usage: npm run sandbox -- build|start|refresh|stop|shell|pi|rex|check|list-profiles|show-profile ID|validate-profile ID|effective-profile ID|export-profiles ARCHIVE|import-profiles ARCHIVE|review-profile ID|approve-profile ID DIGEST|review-update ID|approve-update ID DIGEST|configure MODEL_ID API|reset --confirm",
      );
      return 1;
    }
    return 0;
  } catch (error) {
    if (command === "check") console.error(error);
    if (error instanceof Error && /busy/.test(error.message))
      console.error("Profile is busy; operator recovery may be required.");
    console.error(
      "BLOCKED: sandbox command failed; no private configuration printed.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
