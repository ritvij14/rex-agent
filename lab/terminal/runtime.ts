import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { configure } from "./configure.ts";
import { createGateway, createRelay } from "./transport.ts";

const socket = "/run/rex/inference.sock";
const mode = process.argv[2];

try {
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
        res.setHeader("content-type", "text/event-stream");
        const chunk = {
          id: "synthetic-response",
          object: "chat.completion.chunk",
          model: "synthetic-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: truncated ? "synthetic-private-partial" : "synthetic",
              },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.end(
          `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: truncated ? "length" : "stop" }] })}\n\ndata: [DONE]\n\n`,
        );
      }
    }).listen(8317, "0.0.0.0");
  } else {
    throw new Error();
  }
} catch {
  console.error(
    "Sandbox runtime could not start; no private diagnostics printed.",
  );
  process.exitCode = 1;
}
