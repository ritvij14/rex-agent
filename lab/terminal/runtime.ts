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
        const requestText = JSON.stringify(payload);
        if (
          text.includes("synthetic-revised-instruction") &&
          !requestText.includes("Synthetic revised instruction.")
        ) {
          res.writeHead(400);
          res.end('{"error":"revised instruction was not loaded"}');
          return;
        }
        if (
          text.includes("synthetic-fallback") &&
          payload.model === "synthetic-model"
        ) {
          res.writeHead(503);
          res.end('{"error":"synthetic temporary failure"}');
          return;
        }
        if (
          text.includes("synthetic-reasoning-low") &&
          payload.reasoning_effort !== "low"
        ) {
          res.writeHead(400);
          res.end('{"error":"reasoning effort missing"}');
          return;
        }
        if (
          text.includes("synthetic-resource-instructions") &&
          (!requestText.includes("Shared resource instruction.") ||
            !requestText.includes("Own resource instruction.") ||
            requestText.includes("Ignored resource text."))
        ) {
          res.writeHead(400);
          res.end('{"error":"instruction resource mismatch"}');
          return;
        }
        if (
          text.includes("synthetic-workspace-instruction") &&
          !requestText.includes("Explicit selected workspace instruction.")
        ) {
          res.writeHead(400);
          res.end('{"error":"workspace instruction missing"}');
          return;
        }
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
          "synthetic-mcp-inspect": { name: "mcp__fixture__inspect", args: {} },
          "synthetic-mcp-denied": {
            name: "mcp__fixture__mutate",
            args: {},
            failed: true,
          },
          "synthetic-extension-call": {
            name: "fixture_probe",
            args: {},
          },
          "synthetic-extension-nested": {
            name: "fixture_probe",
            args: { nested: true },
            failed: true,
          },
          "synthetic-skill-reference": {
            name: "read",
            args: {
              path: "/profiles/soul-check/resources/skills/review/support.md",
            },
          },
          "synthetic-skill-use": {
            name: "read",
            args: {
              path: "/profiles/soul-check/resources/skills/review/SKILL.md",
            },
          },
          "synthetic-soul-update": {
            name: "revise_profile",
            args: {
              id: "soul-check",
              instructions: "Synthetic revised instruction.",
            },
          },
          "synthetic-self-update": {
            name: "revise_profile",
            args: {
              id: "coding",
              instructions: "Synthetic revised instruction.",
              whitelist: ["read", "ls"],
              blacklist: ["bash", "edit", "write", "propose_profile"],
            },
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
        if (
          text.includes("synthetic-skill-use") &&
          (!requestText.includes("Selected synthetic skill description.") ||
            (!called && requestText.includes("SKILL_BODY_AFTER_LOADING")) ||
            (called && !requestText.includes("SKILL_BODY_AFTER_LOADING")))
        ) {
          res.writeHead(400);
          res.end('{"error":"skill loading mismatch"}');
          return;
        }
        if (
          text.includes("synthetic-skill-reference") &&
          requestText.includes("REFERENCE_BODY_AFTER_LOADING") !==
            Boolean(called)
        ) {
          res.writeHead(400);
          res.end('{"error":"support reference loading mismatch"}');
          return;
        }
        if (text.includes("synthetic-mcp-inspect") && called) {
          const observed = JSON.parse(
            typeof last?.content === "string" ? last.content : "{}",
          );
          if (
            observed.keys?.join(",") !== "HOME,LANG,PATH,TMPDIR" ||
            !observed.privateHome ||
            !observed.foreignProfileAbsent ||
            !observed.dockerSocketAbsent ||
            observed.args?.join(",") !== "synthetic-installed"
          ) {
            res.writeHead(400);
            res.end('{"error":"MCP isolation outcome mismatch"}');
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
                      : text.includes("synthetic-template correctness")
                        ? "synthetic-template-ok"
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
