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
  "limits-check",
  "extension-check",
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
    `const f=require('node:fs'),crypto=require('node:crypto'); const extensionHash=crypto.createHash('sha256').update(f.readFileSync('/opt/rex/operator-extensions/fixture.mjs')).digest('hex'); f.mkdirSync('/profiles/shared');
     f.writeFileSync('/profiles/shared/configuration.json', JSON.stringify({version:2,extensionCatalog:[{id:'fixture',sha256:extensionHash,tools:['fixture_probe']}],resources:{instructions:['resources/common.md']},limits:{deadlineMs:60000,maxRequests:4,maxHistoryBytes:131072},models:['synthetic-model','glm-5.3-flash-cloud','alternate-model'].map(id=>({id,api:'openai-completions',contextWindow:65536,maxOutputTokens:0,reasoning:id!=='glm-5.3-flash-cloud'})),model:{provider:'cli-proxy',id:'synthetic-model',thinking:'low',overrides:['alternate-model'],fallbacks:['alternate-model']},tools:{whitelist:['*'],blacklist:[]}}));
     f.mkdirSync('/profiles/shared/resources'); f.writeFileSync('/profiles/shared/resources/common.md','Shared resource instruction.');
     f.writeFileSync('/profiles/shared/REX_SOUL.md','Common synthetic instructions.');
     f.mkdirSync('/profiles/extension-check'); f.writeFileSync('/profiles/extension-check/SOUL.md','Synthetic extension acceptance.'); f.writeFileSync('/profiles/extension-check/profile.json',JSON.stringify({version:2,id:'extension-check',resources:{extensions:['fixture']},tools:{whitelist:['read','ls','fixture_probe'],blacklist:['write','edit','bash','propose_profile']}}));
     f.mkdirSync('/profiles/limits-check'); f.writeFileSync('/profiles/limits-check/SOUL.md','Limited synthetic profile.'); f.writeFileSync('/profiles/limits-check/profile.json',JSON.stringify({version:2,id:'limits-check',limits:{maxRequests:1}}));
     f.mkdirSync('/profiles/soul-check'); f.writeFileSync('/profiles/soul-check/SOUL.md','Synthetic persona.'); f.mkdirSync('/profiles/soul-check/resources'); f.writeFileSync('/profiles/soul-check/resources/own.md','Own resource instruction.'); f.writeFileSync('/profiles/soul-check/resources/ignored.md','Ignored resource text.'); f.mkdirSync('/profiles/soul-check/resources/skills/review',{recursive:true}); f.writeFileSync('/profiles/soul-check/resources/skills/review/SKILL.md','---\\nname: review\\ndescription: Selected synthetic skill description.\\n---\\nSKILL_BODY_AFTER_LOADING'); f.writeFileSync('/profiles/soul-check/resources/skills/review/support.md','REFERENCE_BODY_AFTER_LOADING'); f.mkdirSync('/profiles/soul-check/resources/prompts'); f.writeFileSync('/profiles/soul-check/resources/prompts/review.md','synthetic-template $1'); f.writeFileSync('/profiles/soul-check/profile.json',JSON.stringify({version:2,id:'soul-check',resources:{workspaceInstructions:['AGENTS.md'],instructions:['resources/own.md'],skills:['resources/skills/review/SKILL.md'],prompts:['resources/prompts/review.md'],references:['resources/skills/review/support.md']}}));`,
  ]);
  requireSuccess(seed);
  const run = (
    id: string,
    task: string,
    newSession = false,
    maintain = false,
  ) =>
    runProfileWorker({
      project,
      profile: id,
      input: `profile: ${id}\n${task}`,
      newSession,
      maintain,
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
  requireSuccess(
    runProfileWorker({
      project,
      profile: "soul-check",
      command: [
        "node",
        "-e",
        "require('node:fs').writeFileSync('/workspace/AGENTS.md','Explicit selected workspace instruction.');",
      ],
    }),
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
  const overridden = runProfileWorker({
    project,
    profile: "soul-check",
    modelOverride: "alternate-model",
    input: "profile: soul-check\nsynthetic-cap-free-response",
  });
  assert.match(
    requireSuccess(overridden),
    /profile=soul-check model=alternate-model/,
  );
  assert.match(
    requireSuccess(run("soul-check", "synthetic-cap-free-response")),
    /model=synthetic-model/,
  );
  assert.equal(
    runProfileWorker({
      project,
      profile: "soul-check",
      modelOverride: "glm-5.3-flash-cloud",
      input: "profile: soul-check\nMust be denied",
    }).status,
    1,
  );
  requireSuccess(run("soul-check", "synthetic-skill-use", true));
  requireSuccess(run("soul-check", "synthetic-skill-reference", true));
  assert.match(
    requireSuccess(run("soul-check", "/review correctness", true)),
    /synthetic-template-ok/,
  );
  requireSuccess(run("soul-check", "synthetic-workspace-instruction", true));
  requireSuccess(run("soul-check", "synthetic-resource-instructions", true));
  requireSuccess(run("soul-check", "synthetic-reasoning-low", true));
  assert.equal(run("limits-check", "synthetic-write-marker", true).status, 1);
  requireSuccess(
    runProfileWorker({
      project,
      profile: "limits-check",
      command: [
        "node",
        "-e",
        "const a=require('node:assert/strict'),f=require('node:fs');a.equal(f.readFileSync('/workspace/model-marker.txt','utf8'),'synthetic-coding');",
      ],
    }),
  );
  requireSuccess(run("limits-check", "Recovered bounded turn", true));
  requireSuccess(run("extension-check", "synthetic-extension-call", true));
  requireSuccess(run("extension-check", "synthetic-extension-nested", true));
  requireSuccess(
    runProfileWorker({
      project,
      profile: "extension-check",
      command: [
        "node",
        "-e",
        "const f=require('node:fs'),a=require('node:assert/strict');a.equal(f.readFileSync('/workspace/extension-marker.txt','utf8'),'executed');a.equal(f.existsSync('/workspace/extension-forbidden.txt'),false);",
      ],
    }),
  );
  const fallbackAnswer = requireSuccess(
    run("soul-check", "synthetic-fallback", true),
  );
  assert.match(fallbackAnswer, /model=alternate-model/);
  assert.match(
    fallbackAnswer,
    /model-attempts=synthetic-model,alternate-model/,
  );
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
  requireSuccess(run("coding", "synthetic-self-update", false, true));
  const revision = JSON.parse(
    requireSuccess(operatorProfileCommand(project, "review-update", "coding")),
  );
  assert.equal(revision.provenance.operation, "update");
  assert.equal(revision.provenance.origin, "coding");
  assert.equal(
    operatorProfileCommand(project, "approve-update", "coding", "0".repeat(64))
      .status,
    1,
  );
  const codingName = `${project}-rex-coding`;
  requireSuccess(
    docker(
      workerDockerArgs({
        project,
        image: IMAGE,
        profile: "coding",
        volumes: workerVolumes(project, "coding"),
        name: codingName,
        detached: true,
        command: ["sleep", "120"],
      }),
    ),
  );
  assert.throws(
    () =>
      operatorProfileCommand(
        project,
        "approve-update",
        "coding",
        revision.digest,
      ),
    /busy/,
  );
  requireSuccess(docker(["rm", "-f", codingName]));
  requireSuccess(
    operatorProfileCommand(
      project,
      "approve-update",
      "coding",
      revision.digest,
    ),
  );
  requireSuccess(run("coding", "synthetic-revised-instruction", true));
  assert.equal(
    operatorProfileCommand(project, "approve-update", "coding", revision.digest)
      .status,
    1,
  );
  requireSuccess(run("soul-check", "synthetic-soul-update", true, true));
  const soulRevision = JSON.parse(
    requireSuccess(
      operatorProfileCommand(project, "review-update", "soul-check"),
    ),
  );
  assert.equal(soulRevision.definition.soul, "Synthetic revised instruction.");
  assert.equal(soulRevision.definition.model, undefined);
  assert.equal(soulRevision.definition.tools, undefined);
  requireSuccess(
    operatorProfileCommand(
      project,
      "approve-update",
      "soul-check",
      soulRevision.digest,
    ),
  );
  requireSuccess(run("soul-check", "synthetic-revised-instruction", true));
  console.log(
    "PASS: installed profile workers, private volumes/configuration, real shell/tool denials, concurrency, truncation recovery, builder/operator admission and persistence.",
  );
}
