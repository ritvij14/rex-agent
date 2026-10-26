import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../scripts/repo-check.ts";

for (const directory of [".", "lab/terminal"]) {
  test(`${directory} locks patched external undici without upgrading Pi`, () => {
    const lock = JSON.parse(
      readFileSync(join(ROOT, directory, "package-lock.json"), "utf8"),
    );
    const pi = lock.packages["node_modules/@earendil-works/pi-coding-agent"];
    assert.equal(pi.version, "1.3.0");
    const copies = Object.entries(lock.packages).filter(([name]) =>
      name.endsWith("/undici"),
    );
    assert.ok(copies.length > 0, "The patched dependency must be present");
    for (const [, entry] of copies) {
      assert.equal((entry as { version: string }).version, "8.12.2");
    }
  });
}

test("installed Pi resolves the patched external undici dependency", () => {
  const require = createRequire(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  assert.equal(require("undici/package.json").version, "8.12.2");
});
