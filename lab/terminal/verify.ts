import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

async function deniedConnection(host: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("Network denial must be immediate"));
    });
    socket.on("connect", () => {
      socket.destroy();
      reject(new Error("Unexpected external connection"));
    });
    socket.on("error", () => resolve());
  });
}

async function socketRequest(path: string, method = "GET") {
  return await new Promise<number>((resolve, reject) => {
    const req = request(
      { socketPath: "/run/rex/inference.sock", path, method },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const piRequire = createRequire(
    "/opt/rex/node_modules/@earendil-works/pi-coding-agent/package.json",
  );
  assert.equal(piRequire("undici/package.json").version, "8.12.2");
  assert.equal(process.getuid?.(), 1000);
  assert.deepEqual(Object.keys(networkInterfaces()), ["lo"]);
  const status = readFileSync("/proc/self/status", "utf8");
  assert.match(status, /CapEff:\s+0000000000000000/);
  assert.match(status, /NoNewPrivs:\s+1/);
  for (const path of [
    "/Users",
    "/host",
    "/var/run/docker.sock",
    "/state/pi/auth.json",
  ]) {
    assert.equal(existsSync(path), false);
  }
  for (const name of [
    "REX_PROXY_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "PI_SESSION_ID",
  ]) {
    assert.equal(process.env[name], undefined);
  }
  for (const path of [
    "/opt/rex/forbidden",
    "/run/rex/forbidden",
    "/forbidden",
  ]) {
    assert.throws(() => writeFileSync(path, "denied"));
  }
  assert.throws(() => unlinkSync("/run/rex/inference.sock"));
  writeFileSync(
    "/workspace/synthetic-check.txt",
    "workspace survives recreation",
  );
  writeFileSync("/state/synthetic-check.txt", "state survives recreation");
  writeFileSync("/tmp/synthetic-check.txt", "temporary");
  assert.equal(
    readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim(),
    "1073741824",
  );
  assert.equal(readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim(), "128");
  assert.equal(
    readFileSync("/sys/fs/cgroup/memory.swap.max", "utf8").trim(),
    "0",
  );
  const [quota, period] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8")
    .trim()
    .split(" ")
    .map(Number);
  assert.equal(quota! / period!, 2);
  const temporary = statfsSync("/tmp");
  assert.equal(temporary.bsize * temporary.blocks <= 64 * 1024 * 1024, true);
  for (const host of ["1.1.1.1", "172.17.0.1", "192.168.65.254"]) {
    await deniedConnection(host, 8317);
  }
  for (const path of [
    "/v0/management/config",
    "/v8/management/config",
    "/login",
    "http://example.com/v1/models",
  ]) {
    assert.equal(await socketRequest(path), 403);
  }
  const models = await fetch("http://127.0.0.1:8317/v1/models").then((res) =>
    res.json(),
  );
  assert.deepEqual(models, { data: [{ id: "synthetic-model" }] });
  const inference = await fetch("http://127.0.0.1:8317/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "synthetic-model",
      messages: [{ role: "user", content: "synthetic input" }],
    }),
  });
  assert.equal(inference.status, 200);
  assert.match(await inference.text(), /synthetic/);

  const children: ReturnType<typeof spawn>[] = [];
  let denied = false;
  try {
    for (let i = 0; i < 128; i++) {
      const child = spawn("sleep", ["30"], { stdio: "ignore" });
      const result = await new Promise<boolean>((resolve) => {
        child.once("spawn", () => resolve(true));
        child.once("error", (error: NodeJS.ErrnoException) => {
          assert.equal(error.code, "EAGAIN");
          resolve(false);
        });
      });
      if (!result) {
        denied = true;
        break;
      }
      children.push(child);
    }
    assert.equal(denied, true, "Process limit must actually reject a child");
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.kill();
          }),
      ),
    );
  }
  console.log(
    "PASS: filesystem, identity, networking, inference gate, cgroup limits, and process-limit enforcement.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  console.error("FAIL: synthetic sandbox boundary check.");
  process.exitCode = 1;
});
