import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as profiles from "@rex/profiles";

test("explicit instruction resources are ordered and do not scan neighboring files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rex-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "coding", "resources"), { recursive: true });
  await writeFile(join(root, "coding", "SOUL.md"), "Synthetic persona.");
  await writeFile(
    join(root, "coding", "resources", "first.md"),
    "First instruction.",
  );
  await writeFile(
    join(root, "coding", "resources", "second.md"),
    "Second instruction.",
  );
  await writeFile(
    join(root, "coding", "resources", "ignored.md"),
    "Must not be loaded.",
  );
  const result = await profiles.loadInstructionResources(root, "coding", [
    "resources/second.md",
    "resources/first.md",
  ]);
  assert.deepEqual(result, [
    { path: "resources/second.md", text: "Second instruction." },
    { path: "resources/first.md", text: "First instruction." },
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
  assert.deepEqual(
    await profiles.loadInstructionResources(root, "coding", []),
    [],
  );
});

test("instruction resources fail closed on traversal, links, bounds and invalid files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rex-resources-denied-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "coding", "resources"), { recursive: true });
  await writeFile(join(root, "coding", "SOUL.md"), "Synthetic persona.");
  await writeFile(join(root, "outside.md"), "Outside the selected profile.");
  const home = join(root, "coding", "resources");
  await writeFile(join(home, "blank.md"), "  \n");
  await writeFile(join(home, "large.md"), "x".repeat(16385));
  await symlink(join(root, "outside.md"), join(home, "link.md"));
  await symlink(root, join(home, "linked"), "dir");
  await mkdir(join(home, "directory.md"));
  for (let i = 0; i < 8; i++)
    await writeFile(join(home, `file-${i}.md`), "x".repeat(16384));
  const cases = [
    ["../outside.md"],
    ["resources/../../outside.md"],
    ["/outside.md"],
    ["resources/linked/outside.md"],
    ["resources/link.md"],
    ["resources/blank.md"],
    ["resources/large.md"],
    ["resources/missing.md"],
    ["resources/directory.md"],
    ["resources/file-0.md", "resources/file-0.md"],
    ["resources/file-0.md "],
    ["resources//file-0.md"],
    Array.from({ length: 9 }, (_, i) => `resources/file-${i}.md`),
    Array.from({ length: 5 }, (_, i) => `resources/file-${i}.md`),
  ];
  for (const paths of cases) {
    await assert.rejects(
      profiles.loadInstructionResources(root, "coding", paths),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          "Instruction resource is unavailable or invalid.",
        );
        return true;
      },
    );
  }
  await assert.rejects(profiles.loadInstructionResources(root, "missing", []));
});

test("workspace instruction opt-in never traverses or follows links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rex-workspace-instructions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(root, "AGENTS.md"), "Must not discover parent.");
  await writeFile(
    join(workspace, "AGENTS.md"),
    "Selected workspace instruction.",
  );
  await symlink(join(root, "AGENTS.md"), join(workspace, "linked.md"));
  await symlink(root, join(workspace, "linked"), "dir");
  await assert.rejects(
    profiles.loadWorkspaceInstructions(join(root, "missing"), []),
    /Instruction resource/,
  );
  const result = await profiles.loadWorkspaceInstructions(workspace, [
    "AGENTS.md",
  ]);
  assert.deepEqual(result, [
    { path: "AGENTS.md", text: "Selected workspace instruction." },
  ]);
  assert.ok(Object.isFrozen(result));
  for (const paths of [
    ["../AGENTS.md"],
    ["linked.md"],
    ["linked/AGENTS.md"],
    ["/AGENTS.md"],
    ["AGENTS.md\n"],
    ["missing.md"],
  ]) {
    await assert.rejects(
      profiles.loadWorkspaceInstructions(workspace, paths),
      /Instruction resource/,
    );
  }
});
