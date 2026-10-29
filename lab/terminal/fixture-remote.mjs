import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";

let mutations = 0;
const remoteJson = (id, result) =>
  JSON.stringify({ jsonrpc: "2.0", id, result });

const server = https.createServer(
  {
    key: readFileSync("/certs/key.pem"),
    cert: readFileSync("/certs/cert.pem"),
  },
  (req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      try {
        writeFileSync("/workspace/remote-calls.log", "called", { flag: "wx" });
      } catch {
        // already logged; the workspace marker only needs to exist once
      }
      if (req.method === "DELETE") {
        res.writeHead(200);
        res.end();
        return;
      }
      if (
        parsed.method === undefined ||
        String(parsed.method).startsWith("notifications/")
      ) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (req.method === "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (parsed.method === "initialize") {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "fixture-remote-session",
        });
        res.end(
          remoteJson(parsed.id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "remote-fixture", version: "0.0.0" },
          }),
        );
        return;
      }
      if (parsed.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            tools: ["inspect", "mutate"].map((name) => ({
              name,
              description: `Remote fixture ${name}`,
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            })),
          }),
        );
        return;
      }
      if (parsed.method === "tools/call") {
        if (parsed.params?.name === "mutate") {
          mutations++;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            remoteJson(parsed.id, {
              content: [{ type: "text", text: "MUTATION_MUST_NOT_DISPATCH" }],
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            content: [{ type: "text", text: "REMOTE_CONNECTOR_EVIDENCE" }],
          }),
        );
        return;
      }
      if (parsed.method === "resources/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            resources: [
              {
                uri: "remote://evidence",
                name: "evidence",
                _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
              },
            ],
            _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
          }),
        );
        return;
      }
      if (parsed.method === "resources/read") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            contents: [
              {
                uri: parsed.params?.uri,
                text: "REMOTE_RESOURCE_EVIDENCE",
                mimeType: "text/plain",
                _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
              },
            ],
            _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
          }),
        );
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          error: { code: -32601, message: "unsupported" },
        }),
      );
    });
  },
);

const requestedPort = Number(process.env.REX_REMOTE_PORT ?? 443);
server.listen(requestedPort, "0.0.0.0", () => {
  console.log(`fixture remote ready on ${requestedPort}`);
});
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
  writeFileSync("/workspace/remote-exit.txt", "closed");
});
