import assert from "node:assert/strict";
import {
  docker,
  IMAGE,
  NODE,
  operatorProfileCommand,
  requireSuccess,
  runProfileWorker,
  workerDockerArgs,
  workerVolumes,
} from "./profile-worker.ts";

const VERIFY = "/opt/rex/packages/pi-profiles/src/verify.ts";
const profiles = [
  "coding",
  "research",
  "qa",
  "profile-builder",
  "soul-check",
  "synthetic-helper",
];

export function cleanupProfileAcceptance(project: string) {
  for (const id of profiles) {
    const name = `${project}-rex-${id}`;
    const exists = docker([
      "container",
      "inspect",
      "--format",
      "{{.Name}}",
      name,
    ]);
    if (exists.status === 0) requireSuccess(docker(["rm", "-f", name]));
    for (const [kind, name] of Object.entries(workerVolumes(project, id))) {
      if (kind === "socket") continue;
      const exists = docker([
        "volume",
        "inspect",
        "--format",
        "{{.Name}}",
        name,
      ]);
      if (exists.status === 0) requireSuccess(docker(["volume", "rm", name]));
    }
  }
  const master = `${project}_profile-definitions`;
  if (
    docker(["volume", "inspect", "--format", "{{.Name}}", master]).status === 0
  ) {
    requireSuccess(docker(["volume", "rm", master]));
  }
}

export function checkProfileAcceptance(project: string) {
  const seed = docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--user",
    "0:0",
    "--entrypoint",
    "node",
    "-v",
    `${project}_profile-definitions:/profiles`,
    IMAGE,
    "-e",
    `const f=require('node:fs'); f.mkdirSync('/profiles/shared');
     f.writeFileSync('/profiles/shared/configuration.json', JSON.stringify({version:2,model:{provider:'cli-proxy',id:'synthetic-model'},tools:{whitelist:['*'],blacklist:[]}}));
     f.writeFileSync('/profiles/shared/REX_SOUL.md','Common synthetic instructions.');
     f.mkdirSync('/profiles/soul-check'); f.writeFileSync('/profiles/soul-check/SOUL.md','Synthetic persona.');`,
  ]);
  requireSuccess(seed);
  const run = (id: string, task: string, newSession = false) =>
    runProfileWorker({
      project,
      profile: id,
      input: `profile: ${id}\n${task}`,
      newSession,
    });
  const probe = (id: string, action: string) =>
    requireSuccess(
      runProfileWorker({
        project,
        profile: id,
        command: [...NODE, VERIFY, "worker", id, action],
      }),
    );
  probe("coding", "prepare");
  probe("research", "verify");
  assert.equal(
    operatorProfileCommand(project, "review", "synthetic-helper").status,
    1,
    "a coding draft claiming builder origin must not enter builder intake",
  );
  for (const id of [
    "coding",
    "research",
    "qa",
    "profile-builder",
    "soul-check",
  ]) {
    const answer = run(id, "synthetic-cap-free-response", true);
    requireSuccess(answer);
    assert.match(answer.stdout, new RegExp(`profile=${id} model=`));
  }
  requireSuccess(run("coding", "synthetic-write-marker"));
  requireSuccess(run("coding", "synthetic-shell-isolation"));
  requireSuccess(run("research", "synthetic-read-foreign"));
  requireSuccess(run("qa", "synthetic-qa-isolation"));
  requireSuccess(run("qa", "synthetic-qa-denied-write"));
  probe("qa", "verify");
  probe("coding", "check");
  const truncated = run("research", "synthetic-truncated-response", true);
  assert.equal(truncated.status, 1);
  assert.equal(truncated.stdout, "");
  assert.match(truncated.stderr, /truncated.*output limit/i);
  assert.ok(!truncated.stderr.includes("synthetic-private-partial"));
  requireSuccess(run("research", "synthetic-cap-free-response"));
  assert.throws(() =>
    runProfileWorker({
      project,
      profile: "research",
      input: "profile: coding\nTask",
    }),
  );
  assert.throws(() =>
    runProfileWorker({
      project,
      profile: "research",
      input: "Missing selector",
    }),
  );

  // Concurrent containers reserve profile identity independently of writable agent state.
  const names = ["coding", "research"].map((id) => `${project}-rex-${id}`);
  try {
    for (const id of ["coding", "research"]) {
      requireSuccess(
        docker(
          workerDockerArgs({
            project,
            image: IMAGE,
            profile: id,
            volumes: workerVolumes(project, id),
            name: `${project}-rex-${id}`,
            detached: true,
            command: ["sleep", "120"],
          }),
        ),
      );
      const inspected = JSON.parse(
        requireSuccess(
          docker([
            "inspect",
            "--format",
            "{{json .HostConfig}}",
            `${project}-rex-${id}`,
          ]),
        ),
      );
      assert.equal(inspected.NetworkMode, "none");
      assert.equal(inspected.PidMode, "");
      assert.equal(inspected.Privileged, false);
      assert.equal(inspected.ReadonlyRootfs, true);
      assert.deepEqual(inspected.CapDrop, ["ALL"]);
      assert.ok(inspected.SecurityOpt.includes("no-new-privileges:true"));
      assert.equal(inspected.Memory, 1073741824);
      assert.equal(inspected.PidsLimit, 128);
      const mounts = JSON.parse(
        requireSuccess(
          docker([
            "inspect",
            "--format",
            "{{json .Mounts}}",
            `${project}-rex-${id}`,
          ]),
        ),
      ) as { Type: string; Name: string; Destination: string; RW: boolean }[];
      const volumes = workerVolumes(project, id);
      for (const [key, destination] of Object.entries({
        defs: "/profiles",
        workspace: "/workspace",
        state: "/state",
        proposals: "/proposals",
        socket: "/run/rex",
      })) {
        const mount = mounts.find(
          (entry) => entry.Destination === destination,
        )!;
        assert.equal(mount.Type, "volume");
        assert.equal(mount.Name, volumes[key as keyof typeof volumes]);
        assert.equal(mount.RW, !["defs", "socket"].includes(key));
      }
      assert.equal(mounts.filter((entry) => entry.Type === "volume").length, 5);
      assert.ok(!mounts.some((entry) => entry.Type === "bind"));
    }
    assert.throws(() => run("coding", "must not start"), /busy/);
    // A worker cannot remove the operator lock, control Docker, or see a peer's root.
    requireSuccess(
      docker([
        "exec",
        names[0]!,
        "node",
        "-e",
        `const a=require('node:assert/strict'),f=require('node:fs');
      a.deepEqual(f.readdirSync('/profiles').sort(),['coding','shared']);
      a.throws(()=>f.readFileSync('/profiles/research/profile.json'));
      a.equal(f.existsSync('/var/run/docker.sock'),false);
      for(const pid of f.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){
        a.equal(f.existsSync('/proc/'+pid+'/root/profiles/research'),false);
      }`,
      ]),
    );
  } finally {
    for (const name of names) {
      if (
        docker(["container", "inspect", "--format", "{{.Name}}", name])
          .status === 0
      )
        requireSuccess(docker(["rm", "-f", name]));
    }
  }
  requireSuccess(run("coding", "recovered after forced termination"));

  // The real builder tool writes its private proposals; the operator supplies the source identity.
  requireSuccess(run("profile-builder", "synthetic-create-profile"));
  const reviewed = JSON.parse(
    requireSuccess(
      operatorProfileCommand(project, "review", "synthetic-helper"),
    ),
  );
  assert.equal(reviewed.provenance.origin, "profile-builder");
  const sourceVolume = workerVolumes(project, "profile-builder").proposals;
  const setProvenance = (value: unknown) =>
    requireSuccess(
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--entrypoint",
        "node",
        "-v",
        `${sourceVolume}:/proposals`,
        IMAGE,
        "-e",
        `require('node:fs').writeFileSync('/proposals/synthetic-helper/provenance.json',process.argv[1])`,
        JSON.stringify(value),
      ]),
    );
  setProvenance({
    ...reviewed.provenance,
    origin: "synthetic-helper",
    operation: "update",
    baseDigest: "0".repeat(64),
  });
  assert.equal(
    operatorProfileCommand(project, "review", "synthetic-helper").status,
    1,
    "claimed self-update from builder must fail",
  );
  setProvenance(reviewed.provenance);
  assert.equal(
    operatorProfileCommand(
      project,
      "approve",
      "synthetic-helper",
      "0".repeat(64),
    ).status,
    1,
  );
  requireSuccess(
    operatorProfileCommand(
      project,
      "approve",
      "synthetic-helper",
      reviewed.digest,
    ),
  );
  requireSuccess(run("synthetic-helper", "synthetic-cap-free-response"));
  probe("coding", "check");
  console.log(
    "PASS: installed profile workers, private volumes/configuration, real shell/tool denials, concurrency, truncation recovery, builder/operator admission and persistence.",
  );
}
