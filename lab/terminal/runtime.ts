import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { configure } from "./configure.ts";
import { createGateway, createRelay } from "./transport.ts";

const socket = "/run/rex/inference.sock";
const mode = process.argv[2];

async function main() {
  if (mode === "configure") {
    configure(process.argv[3] ?? "", process.argv[4] ?? "");
  } else if (mode === "gateway") {
    process.umask(0o077);
    if (existsSync(socket)) unlinkSync(socket);
    const server = createGateway({
      upstream: new URL(
        process.env.REX_PROXY_ORIGIN ?? "http://host.docker.internal:8317",
      ),
      apiKey: process.env.REX_PROXY_API_KEY,
    });
    server.listen(socket, () => chmodSync(socket, 0o600));
    process.on("SIGTERM", () => {
      server.closeAllConnections();
      server.close();
    });
  } else if (mode === "sandbox") {
    mkdirSync("/state/pi", { recursive: true, mode: 0o700 });
    const server = createRelay(socket).listen(8317, "127.0.0.1");
    process.on("SIGTERM", () => {
      server.closeAllConnections();
      server.close();
    });
  } else if (mode === "worker") {
    mkdirSync("/state/pi", { recursive: true, mode: 0o700 });
    const relay = createRelay(socket).listen(8317, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      relay.once("listening", () => resolve());
      relay.once("error", reject);
    });
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "/opt/rex/node_modules/tsx/dist/loader.mjs",
          "/opt/rex/packages/pi-profiles/src/cli.ts",
          ...process.argv.slice(3),
        ],
        { stdio: "inherit" },
      );
      process.exitCode = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
    } finally {
      relay.closeAllConnections();
      relay.close();
    }
  } else if (mode === "fixture") {
    createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "synthetic-model" }] }));
      } else {
        const payload = JSON.parse(body);
        const user = payload.messages?.findLast(
          (message: { role: string }) => message.role === "user",
        );
        const text = JSON.stringify(user?.content ?? "");
        const truncated = text.includes("synthetic-truncated-response");
        if (
          text.includes("synthetic-cap-free-response") &&
          (Object.hasOwn(payload, "max_tokens") ||
            Object.hasOwn(payload, "max_completion_tokens"))
        ) {
          res.writeHead(400);
          res.end('{"error":"synthetic output-cap assertion failed"}');
          return;
        }
        const tasks: Record<
          string,
          { name: string; args: unknown; failed?: boolean }
        > = {
          "synthetic-write-marker": {
            name: "write",
            args: {
              path: "/workspace/model-marker.txt",
              content: "synthetic-coding",
            },
          },
          "synthetic-shell-isolation": {
            name: "bash",
            args: {
              command: `node -e "const a=require('node:assert/strict'),f=require('node:fs');a.deepEqual(f.readdirSync('/profiles').sort(),['coding','shared']);a.throws(()=>f.readFileSync('/profiles/research/profile.json'));a.equal(f.readFileSync('/workspace/synthetic-check.txt','utf8'),'coding');a.equal(f.existsSync('/var/run/docker.sock'),false);"`,
            },
          },
          "synthetic-read-foreign": {
            name: "read",
            args: { path: "/profiles/coding/profile.json" },
            failed: true,
          },
          "synthetic-qa-isolation": {
            name: "bash",
            args: {
              command: `node -e "const a=require('node:assert/strict'),f=require('node:fs');a.deepEqual(f.readdirSync('/profiles').sort(),['qa','shared']);a.throws(()=>f.readFileSync('/profiles/coding/profile.json'));a.equal(f.existsSync('/var/run/docker.sock'),false);"`,
            },
          },
          "synthetic-qa-denied-write": {
            name: "write",
            args: {
              path: "/workspace/qa-must-not-write.txt",
              content: "synthetic",
            },
            failed: true,
          },
          "synthetic-create-profile": {
            name: "propose_profile",
            args: {
              id: "synthetic-helper",
              instructions: "A synthetic helper.",
              whitelist: ["read"],
              blacklist: ["bash"],
            },
          },
        };
        const task = Object.entries(tasks).find(([name]) =>
          text.includes(name),
        )?.[1];
        const last = payload.messages.at(-1);
        const called = task && last?.role === "tool";
        if (called) {
          const result = JSON.stringify(last.content);
          const failed = /ENOENT|not found|denied|error/i.test(result);
          if (failed !== Boolean(task.failed)) {
            res.writeHead(400);
            res.end('{"error":"synthetic tool outcome mismatch"}');
            return;
          }
        }
        const invoke = task && !called;
        res.setHeader("content-type", "text/event-stream");
        const chunk = {
          id: "synthetic-response",
          object: "chat.completion.chunk",
          model: "synthetic-model",
          choices: [
            {
              index: 0,
              delta: invoke
                ? {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "synthetic-call",
                        type: "function",
                        function: {
                          name: task.name,
                          arguments: JSON.stringify(task.args),
                        },
                      },
                    ],
                  }
                : {
                    role: "assistant",
                    content: truncated
                      ? "synthetic-private-partial"
                      : "synthetic",
                  },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.end(
          `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: truncated ? "length" : invoke ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
        );
      }
    }).listen(8317, "0.0.0.0");
  } else {
    throw new Error();
  }
}

main().catch(() => {
  console.error(
    "Sandbox runtime could not start; no private diagnostics printed.",
  );
  process.exitCode = 1;
});
