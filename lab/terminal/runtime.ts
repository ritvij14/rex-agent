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
          "synthetic-discovery-use": {
            name: "tool_search",
            args: { query: "inspect", limit: 1 },
          },
          "synthetic-discovery-script": {
            name: "codemode",
            args: {
              code: "const matches=await searchTools('inspect',{namespace:'discovery',limit:1});text(matches);text(await describeNamespace('discovery'));text(await tools[matches[0].name]({}));text(await tools.read_mcp_resource({server:'discovery',uri:'fixture://own/evidence'}));",
            },
          },
          "synthetic-discovery-denied": {
            name: "tool_search",
            args: { query: "mutate" },
          },
          "synthetic-discovery-forbidden": {
            name: "mcp__discovery__mutate",
            args: {},
            failed: true,
          },
          "synthetic-uncertain-script": {
            name: "codemode",
            args: {
              code: "await tools.write({path:'before-uncertain.txt',content:'before'});try {await tools.mcp__uncertain__inspect({});} catch {} await tools.write({path:'after-uncertain.txt',content:'after'});",
            },
            failed: true,
          },
          "synthetic-codemode-allowed": {
            name: "codemode",
            args: {
              code: "text('ENV_SAFE_'+typeof models+'_'+typeof process);text(await tools.mcp__fixture__inspect({}));text(await tools.read_mcp_resource({server:'fixture',uri:'fixture://own/evidence'}));",
            },
          },
          "synthetic-codemode-mutation": {
            name: "codemode",
            args: { code: "await tools.mcp__fixture__mutate({})" },
            failed: true,
          },
          "synthetic-codemode-unselected": {
            name: "codemode",
            args: {
              code: "await tools.read_mcp_resource({server:'unselected',uri:'fixture://own/evidence'})",
            },
            failed: true,
          },
          "synthetic-codemode-disabled": {
            name: "codemode",
            args: { code: "text('SHOULD_NOT_EXECUTE')" },
            failed: true,
          },
          "synthetic-mcp-resource-list": {
            name: "list_mcp_resources",
            args: { server: "fixture" },
          },
          "synthetic-mcp-resource-templates": {
            name: "list_mcp_resource_templates",
            args: { server: "fixture" },
          },
          "synthetic-mcp-resource-read": {
            name: "read_mcp_resource",
            args: { server: "fixture", uri: "fixture://own/evidence" },
          },
          "synthetic-mcp-nested-inspect": {
            name: "fixture_probe",
            args: { target: "mcp__fixture__inspect", arguments: {} },
          },
          "synthetic-mcp-nested-denied": {
            name: "fixture_probe",
            args: { target: "mcp__fixture__mutate", arguments: {} },
            failed: true,
          },
          "synthetic-mcp-nested-resource-read": {
            name: "fixture_probe",
            args: {
              target: "read_mcp_resource",
              arguments: { server: "fixture", uri: "fixture://own/evidence" },
            },
          },
          "synthetic-mcp-nested-unselected": {
            name: "fixture_probe",
            args: {
              target: "read_mcp_resource",
              arguments: {
                server: "unselected",
                uri: "fixture://own/evidence",
              },
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
        let task = Object.entries(tasks).find(([name]) =>
          text.includes(name),
        )?.[1];
        const last = payload.messages.at(-1);
        let called = task && last?.role === "tool";
        if (called) {
          const result = JSON.stringify(last.content);
          const failed = /ENOENT|not found|denied|error/i.test(result);
          if (failed !== Boolean(task?.failed)) {
            res.writeHead(400);
            res.end('{"error":"synthetic tool outcome mismatch"}');
            return;
          }
        }
        if (text.includes("synthetic-discovery")) {
          const names = (payload.tools ?? []).map(
            (tool: { function?: { name?: string } }) => tool.function?.name,
          );
          if (
            JSON.stringify(payload.tools).includes("mcp__fixture__") ||
            names.includes("mcp__discovery__mutate") ||
            (!called &&
              (names.includes("mcp__discovery__inspect") ||
                JSON.stringify(payload.tools).includes(
                  "Synthetic fixture inspect",
                )))
          ) {
            res.writeHead(400);
            res.end('{"error":"deferred declaration scope mismatch"}');
            return;
          }
          if (
            text.includes("synthetic-discovery-use") &&
            called &&
            String(last.content).startsWith("Loaded ")
          ) {
            if (!names.includes("mcp__discovery__inspect")) {
              res.writeHead(400);
              res.end('{"error":"discovered tool was not declared"}');
              return;
            }
            task = { name: "mcp__discovery__inspect", args: {} };
            called = false;
          }
          if (
            text.includes("synthetic-discovery-denied") &&
            called &&
            !String(last.content).includes("No matching tools found")
          ) {
            res.writeHead(400);
            res.end('{"error":"denied metadata discovered"}');
            return;
          }
          if (
            text.includes("synthetic-discovery-script") &&
            called &&
            (!String(last.content).includes("INSTALLED_RESOURCE_EVIDENCE") ||
              !String(last.content).includes("mcp__discovery"))
          ) {
            res.writeHead(400);
            res.end('{"error":"script discovery outcome mismatch"}');
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
        if (
          (text.includes("synthetic-mcp-inspect") ||
            text.includes("synthetic-mcp-nested-inspect")) &&
          called
        ) {
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
        if (
          (text.includes("synthetic-mcp-resource") ||
            text.includes("synthetic-mcp-nested-resource-read")) &&
          called
        ) {
          const result = JSON.stringify(last?.content);
          const expected =
            text.includes("synthetic-mcp-resource-read") ||
            text.includes("synthetic-mcp-nested-resource-read")
              ? "INSTALLED_RESOURCE_EVIDENCE"
              : text.includes("synthetic-mcp-resource-templates")
                ? "fixture://own/{name}"
                : "fixture://own/evidence";
          if (
            !result.includes(expected) ||
            requestText.includes("MCP_META_MUST_STAY_PRIVATE")
          ) {
            res.writeHead(400);
            res.end('{"error":"MCP resource outcome mismatch"}');
            return;
          }
        }
        if (
          text.includes("synthetic-codemode-allowed") &&
          called &&
          (!String(last?.content).includes("INSTALLED_RESOURCE_EVIDENCE") ||
            !String(last?.content).includes("ENV_SAFE_undefined_undefined") ||
            requestText.includes("MCP_META_MUST_STAY_PRIVATE"))
        ) {
          res.writeHead(400);
          res.end('{"error":"Codemode output mismatch"}');
          return;
        }
        const invoke = called ? undefined : task;
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
                        id:
                          text.includes("synthetic-discovery-use") &&
                          invoke.name === "mcp__discovery__inspect"
                            ? "synthetic-discovered-call"
                            : "synthetic-call",
                        type: "function",
                        function: {
                          name: invoke.name,
                          arguments: JSON.stringify(invoke.args),
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
