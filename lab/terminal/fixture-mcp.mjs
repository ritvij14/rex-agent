import { createInterface } from "node:readline";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

try {
  if (
    readFileSync("mcp-workspace-proof.txt", "utf8") !==
    "synthetic-own-workspace"
  )
    process.exit(2);
} catch {
  process.exit(2);
}
writeFileSync("mcp-pid.txt", String(process.pid));
writeFileSync("mcp-exit.txt", "starting");
if (process.argv.includes("fail-startup")) process.exit(1);
setTimeout(
  () => process.exit(3),
  process.argv.includes("live-check") ? 180000 : 12000,
).unref();
const input = createInterface({ input: process.stdin });
input.on("close", () => {
  writeFileSync("mcp-exit.txt", "closed");
  process.exit(0);
});
input.on("line", (line) => {
  if (process.argv.includes("stall-startup")) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") {
    result = {
      protocolVersion: message.params.protocolVersion,
      capabilities: {
        tools: {},
        ...(process.argv.includes("no-resources") ? {} : { resources: {} }),
      },
      serverInfo: { name: "rex-fixture", version: "0.0.0" },
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: ["inspect", "mutate"].map((name) => ({
        name,
        description: `Synthetic fixture ${name}`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      })),
    };
  } else if (message.method === "resources/list") {
    appendFileSync("mcp-resource-calls.txt", "listed;");
    result = {
      resources: [
        {
          uri: message.params?.cursor
            ? "fixture://own/second-evidence"
            : "fixture://own/evidence",
          name: "evidence",
          _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
        },
      ],
      ...(message.params?.cursor ? {} : { nextCursor: "next-page" }),
      _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
    };
    if (process.argv.includes("bad-resource-meta"))
      result.resources[0].name = { _meta: "MCP_META_MUST_STAY_PRIVATE" };
  } else if (
    message.method === "resources/templates/list" &&
    !process.argv.includes("no-templates")
  ) {
    appendFileSync("mcp-resource-calls.txt", "templates;");
    result = {
      resourceTemplates: [
        {
          uriTemplate: "fixture://own/{name}",
          name: "own-evidence",
          _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
        },
      ],
      _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
    };
  } else if (message.method === "resources/read") {
    if (
      !["fixture://own/evidence", "fixture://own/second-evidence"].includes(
        message.params?.uri,
      )
    ) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Synthetic resource unavailable." } })}\n`,
      );
      return;
    }
    appendFileSync("mcp-resource-calls.txt", "read;");
    result = {
      contents: [
        {
          uri: message.params.uri,
          text: readFileSync("mcp-evidence.md", "utf8"),
          mimeType: "text/markdown",
          _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
        },
      ],
      _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
    };
  } else if (message.method === "tools/call") {
    try {
      if (
        readFileSync("mcp-workspace-proof.txt", "utf8") !==
        "synthetic-own-workspace"
      )
        throw new Error();
      if (message.params.name === "mutate") {
        writeFileSync("mcp-forbidden.txt", "must-not-exist");
        result = { content: [{ type: "text", text: "mutated" }] };
      } else if (message.params.name === "inspect") {
        appendFileSync("mcp-calls.txt", "called");
        if (process.argv.includes("crash-tool")) process.exit(1);
        if (process.argv.includes("reject-tool")) {
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "synthetic-private-mcp-error" } })}\n`,
          );
          return;
        }
        if (process.argv.includes("hold-tool")) return;
        writeFileSync("mcp-marker.txt", "executed");
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                keys: Object.keys(process.env).sort(),
                privateHome:
                  process.env.HOME === process.env.TMPDIR &&
                  process.env.HOME?.includes("/mcp-"),
                args: process.argv.slice(2),
                foreignProfileAbsent: !existsSync(
                  "/profiles/coding/profile.json",
                ),
                dockerSocketAbsent: !existsSync("/var/run/docker.sock"),
              }),
            },
          ],
        };
        if (process.argv.includes("large-result"))
          result = { content: [{ type: "text", text: "x".repeat(65536) }] };
        if (process.argv.includes("bad-result"))
          result = { content: "synthetic-invalid-result" };
      } else throw new Error();
    } catch {
      result = {
        isError: true,
        content: [{ type: "text", text: "Synthetic workspace guard failed." }],
      };
    }
  } else {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported fixture method." } })}\n`,
    );
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
  );
});
