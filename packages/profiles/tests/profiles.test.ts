import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import {
  lookupProfile,
  ProfileError,
  ProfileRuntime,
  type ProfileErrorCode,
} from "@rex/profiles";

async function fixture(t: TestContext) {
  const temporary = await mkdtemp(join(tmpdir(), "rex-profiles-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = await realpath(temporary);
  async function profile(id: string, definition = JSON.stringify({ id })) {
    const home = join(root, id);
    await mkdir(home);
    await writeFile(join(home, "profile.json"), definition);
    await writeFile(join(home, "marker.txt"), id);
    return home;
  }
  return { root, profile, runtime: new ProfileRuntime(root) };
}

function errorCode(code: ProfileErrorCode) {
  return (error: unknown) =>
    error instanceof ProfileError && error.code === code;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

test("lookup returns a frozen profile at its direct canonical home", async (t) => {
  const { root, profile } = await fixture(t);
  const home = await profile("profile-a");
  const found = await lookupProfile(root, "profile-a");
  assert.deepEqual(found, { id: "profile-a", home });
  assert.ok(Object.isFrozen(found));
  assert.throws(() => Object.assign(found, { id: "profile-b" }), TypeError);
  assert.equal(found.id, "profile-a");
});

test("trusted root paths are trimmed and canonicalized", async (t) => {
  const { root, profile } = await fixture(t);
  const home = await profile("profile-a");
  const alias = join(root, "root-alias");
  await symlink(root, alias, "dir");
  assert.equal((await lookupProfile(` ${alias} `, "profile-a")).home, home);
});

test("root must be explicitly supplied as an absolute path", async () => {
  for (const root of ["", " ", "profiles", undefined, null]) {
    await assert.rejects(
      lookupProfile(root as string, "profile-a"),
      errorCode("INVALID_PROFILES_ROOT"),
    );
    assert.throws(
      () => new ProfileRuntime(root as string),
      errorCode("INVALID_PROFILES_ROOT"),
    );
  }
});

test("lookup rejects missing, malformed and path-like IDs without defaults", async (t) => {
  const { root, profile } = await fixture(t);
  await profile("default");
  const invalid = [
    undefined,
    null,
    1,
    "",
    " profile-a",
    "profile-a ",
    "profile-a\n",
    "Profile-a",
    "1profile",
    "profile_a",
    "profile--a",
    "profile-",
    "../default",
    "..",
    ".",
    "/default",
    "a/b",
    "a\\b",
    "a\0b",
    "%2e%2e",
    "a".repeat(65),
  ];
  for (const id of invalid) {
    await assert.rejects(
      lookupProfile(root, id as string),
      errorCode("INVALID_PROFILE_ID"),
    );
  }
  await assert.rejects(
    lookupProfile(root, "missing"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
});

test("lookup never creates missing roots or profile homes", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(
    lookupProfile(join(root, "absent-root"), "profile-a"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
  await assert.rejects(
    lookupProfile(root, "profile-a"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
  assert.deepEqual(await readdir(root), []);
});

test("a home needs a readable regular profile definition", async (t) => {
  const { root } = await fixture(t);
  await mkdir(join(root, "profile-a"));
  await assert.rejects(
    lookupProfile(root, "profile-a"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
  await mkdir(join(root, "profile-a", "profile.json"));
  await assert.rejects(
    lookupProfile(root, "profile-a"),
    errorCode("INVALID_PROFILE_DEFINITION"),
  );
  await writeFile(join(root, "profile-b"), "not a directory");
  await assert.rejects(
    lookupProfile(root, "profile-b"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
});

test("definitions must contain only the matching profile ID", async (t) => {
  const { root, profile } = await fixture(t);
  const home = await profile("profile-a");
  for (const definition of [
    "",
    "{",
    "null",
    "[]",
    '"profile-a"',
    "{}",
    '{"id":1}',
    '{"id":"profile-b"}',
    '{"id":"profile-a","models":[]}',
  ]) {
    await writeFile(join(home, "profile.json"), definition);
    await assert.rejects(
      lookupProfile(root, "profile-a"),
      errorCode("INVALID_PROFILE_DEFINITION"),
    );
  }
});

test("definitions are bounded to 4096 bytes", async (t) => {
  const { root, profile } = await fixture(t);
  const valid = JSON.stringify({ id: "profile-a" });
  const home = await profile("profile-a", valid.padEnd(4096));
  assert.equal((await lookupProfile(root, "profile-a")).id, "profile-a");
  await writeFile(join(home, "profile.json"), valid.padEnd(4097));
  await assert.rejects(
    lookupProfile(root, "profile-a"),
    errorCode("INVALID_PROFILE_DEFINITION"),
  );
});

test("home aliases and symlink escapes are rejected", async (t) => {
  const { root, profile } = await fixture(t);
  const home = await profile("profile-a");
  await symlink(home, join(root, "profile-b"), "dir");
  await symlink(join(root, ".."), join(root, "profile-c"), "dir");
  for (const id of ["profile-b", "profile-c"]) {
    await assert.rejects(
      lookupProfile(root, id),
      errorCode("PROFILE_UNAVAILABLE"),
    );
  }
});

test("definition symlinks are rejected even within the approved root", async (t) => {
  const { root, profile } = await fixture(t);
  const home = await profile("profile-a");
  const target = join(root, "other-definition.json");
  await writeFile(target, '{"id":"profile-a"}');
  await rm(join(home, "profile.json"));
  await symlink(target, join(home, "profile.json"));
  await assert.rejects(
    lookupProfile(root, "profile-a"),
    errorCode("PROFILE_UNAVAILABLE"),
  );
});

test("lookup errors do not disclose paths, definitions or raw IO errors", async (t) => {
  const { root, profile } = await fixture(t);
  await profile("profile-a", '{"id":"synthetic-private-marker"');
  for (const id of ["profile-a", "absent-profile"]) {
    await assert.rejects(lookupProfile(root, id), (error: unknown) => {
      assert.ok(error instanceof ProfileError);
      const output = `${error.stack} ${JSON.stringify(error)}`;
      for (const value of [root, "synthetic-private-marker", "ENOENT", id]) {
        assert.ok(!output.includes(value));
      }
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("scope requires a valid selected ID before invoking work", async (t) => {
  const { runtime, profile } = await fixture(t);
  await profile("default");
  let invoked = false;
  for (const id of [undefined, "../default", "missing"]) {
    await assert.rejects(
      runtime.run(id as string, () => {
        invoked = true;
      }),
    );
  }
  assert.equal(invoked, false);
  assert.throws(() => runtime.current(), errorCode("NO_PROFILE_SCOPE"));
});

test(
  "concurrent turns read their own profile before and after another turn ends",
  { timeout: 5000 },
  async (t) => {
    const { runtime, profile } = await fixture(t);
    await profile("profile-a");
    await profile("profile-b");
    const both = gate();
    const finishB = gate();
    t.after(() => {
      both.release();
      finishB.release();
    });
    let entered = 0;
    async function work(id: string) {
      assert.equal(runtime.current().id, id);
      if (++entered === 2) both.release();
      await both.promise;
      if (id === "profile-b") await finishB.promise;
      await setImmediate();
      const selected = runtime.current();
      const marker = await readFile(join(selected.home, "marker.txt"), "utf8");
      assert.equal(runtime.current(), selected);
      assert.equal(marker, id);
      return selected.id;
    }
    const a = runtime.run("profile-a", () => work("profile-a"));
    const b = runtime.run("profile-b", () => work("profile-b"));
    assert.throws(() => runtime.current(), errorCode("NO_PROFILE_SCOPE"));
    try {
      assert.equal(await a, "profile-a");
    } finally {
      finishB.release();
    }
    assert.equal(await b, "profile-b");
    assert.throws(() => runtime.current(), errorCode("NO_PROFILE_SCOPE"));
  },
);

test("runtime instances cannot observe one another's scopes", async (t) => {
  const { root, runtime, profile } = await fixture(t);
  await profile("profile-a");
  const other = new ProfileRuntime(root);
  await runtime.run("profile-a", async () => {
    await setImmediate();
    assert.equal(runtime.current().id, "profile-a");
    assert.throws(() => other.current(), errorCode("NO_PROFILE_SCOPE"));
  });
});

test("nested turns are rejected without changing the outer profile", async (t) => {
  const { runtime, profile } = await fixture(t);
  await profile("profile-a");
  await profile("profile-b");
  await runtime.run("profile-a", async () => {
    await assert.rejects(
      runtime.run("profile-b", () => assert.fail("Nested work must not run")),
      errorCode("NESTED_PROFILE_SCOPE"),
    );
    assert.equal(runtime.current().id, "profile-a");
  });
});

for (const failure of ["sync", "async"] as const) {
  test(`${failure} callback failures close retained asynchronous scopes`, async (t) => {
    const { runtime, profile } = await fixture(t);
    await profile("profile-a");
    const finish = gate();
    let retained!: Promise<void>;
    const expected = new Error("synthetic callback failure");
    await assert.rejects(
      runtime.run("profile-a", () => {
        retained = (async () => {
          await finish.promise;
          assert.throws(
            () => runtime.current(),
            errorCode("CLOSED_PROFILE_SCOPE"),
          );
        })();
        if (failure === "sync") throw expected;
        return Promise.reject(expected);
      }),
      (error: unknown) => error === expected,
    );
    finish.release();
    await retained;
    assert.throws(() => runtime.current(), errorCode("NO_PROFILE_SCOPE"));
  });
}

test("completion closes retained scopes even while a new turn is active", async (t) => {
  const { runtime, profile } = await fixture(t);
  await profile("profile-a");
  await profile("profile-b");
  const finish = gate();
  let retained!: Promise<void>;
  const value = await runtime.run("profile-a", () => {
    retained = (async () => {
      await finish.promise;
      assert.throws(() => runtime.current(), errorCode("CLOSED_PROFILE_SCOPE"));
      await assert.rejects(
        runtime.run("profile-b", () => {}),
        errorCode("NESTED_PROFILE_SCOPE"),
      );
    })();
    return 42;
  });
  assert.equal(value, 42);
  await runtime.run("profile-b", async () => {
    finish.release();
    await retained;
    assert.equal(runtime.current().id, "profile-b");
  });
});

test("a pre-aborted turn never invokes its callback", async (t) => {
  const { runtime, profile } = await fixture(t);
  await profile("profile-a");
  const reason = new Error("synthetic cancellation");
  await assert.rejects(
    runtime.run("profile-a", () => assert.fail("Cancelled work must not run"), {
      signal: AbortSignal.abort(reason),
    }),
    (error: unknown) => error === reason,
  );
});

test(
  "cancellation denies scope access and does not affect another turn",
  { timeout: 5000 },
  async (t) => {
    const { runtime, profile } = await fixture(t);
    await profile("profile-a");
    await profile("profile-b");
    const entered = gate();
    const resume = gate();
    t.after(resume.release);
    const controller = new AbortController();
    const reason = new Error("synthetic cancellation");
    const cancelled = assert.rejects(
      runtime.run(
        "profile-a",
        async () => {
          entered.release();
          await resume.promise;
          assert.throws(
            () => runtime.current(),
            (error: unknown) => error === reason,
          );
          return "must not count as success";
        },
        { signal: controller.signal },
      ),
      (error: unknown) => error === reason,
    );
    await entered.promise;
    await runtime.run("profile-b", async () => {
      controller.abort(reason);
      resume.release();
      await cancelled;
      assert.equal(runtime.current().id, "profile-b");
    });
    assert.throws(() => runtime.current(), errorCode("NO_PROFILE_SCOPE"));
    assert.equal(
      await runtime.run("profile-a", () => "recovered"),
      "recovered",
    );
  },
);

test(
  "one failing turn does not close a concurrent successful turn",
  { timeout: 5000 },
  async (t) => {
    const { runtime, profile } = await fixture(t);
    await profile("profile-a");
    await profile("profile-b");
    const active = gate();
    t.after(active.release);
    const expected = new Error("synthetic failure");
    const failed = assert.rejects(
      runtime.run("profile-a", async () => {
        await active.promise;
        throw expected;
      }),
      (error: unknown) => error === expected,
    );
    await runtime.run("profile-b", async () => {
      active.release();
      await failed;
      assert.equal(runtime.current().id, "profile-b");
    });
  },
);

test("turns leave the process environment and working directory unchanged", async (t) => {
  const { root, profile } = await fixture(t);
  await profile("profile-a");
  await profile("profile-b");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
    import { ProfileRuntime } from "@rex/profiles";
    const before = JSON.stringify(process.env);
    const cwd = process.cwd();
    const runtime = new ProfileRuntime(process.env.PROFILES_ROOT);
    await Promise.all(["profile-a", "profile-b"].map(id => runtime.run(id, async () => {
      await new Promise(resolve => setImmediate(resolve));
      if (runtime.current().id !== id) throw new Error("Wrong profile");
    })));
    if (JSON.stringify(process.env) !== before || process.cwd() !== cwd) process.exitCode = 1;
  `,
    ],
    {
      env: {
        HOME: "/synthetic-home",
        REX_HOME: "/synthetic-rex",
        PI_CODING_AGENT_DIR: "/synthetic-pi",
        PROFILES_ROOT: root,
      },
      timeout: 10_000,
    },
  );
  assert.equal(
    result.status,
    0,
    "Isolated process must preserve its environment and cwd",
  );
});
