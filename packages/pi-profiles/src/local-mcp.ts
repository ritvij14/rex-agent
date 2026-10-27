import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  McpClient,
  StdioTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { localMcpToolNames, type LocalMcpServer } from "@rex/profiles";
import { installedModulePaths } from "./installed-modules.ts";

export async function openLocalMcp(
  entries: readonly LocalMcpServer[],
  installedRoot: string | undefined,
  cwd: string,
  agentDir: string,
  signal: AbortSignal,
) {
  const tools: ToolDefinition[] = [];
  const connections: { client: McpClient; transport: StdioTransport }[] = [];
  let temporary: string | undefined;
  let invalid = false;
  let closing: Promise<void> | undefined;
  const assertReady = () => {
    signal.throwIfAborted();
    if (
      invalid ||
      connections.some(({ client }) => client.connectionState !== "connected")
    )
      throw new Error("Local MCP connection is unavailable.");
  };
  const close = () =>
    (closing ??= (async () => {
      invalid = true;
      signal.removeEventListener("abort", abort);
      await Promise.all(
        connections.map(async ({ client, transport }) => {
          const stopped = transport.close();
          await client.close();
          await stopped;
        }),
      );
      if (temporary) await rm(temporary, { recursive: true, force: true });
    })());
  const abort = () => {
    void close().catch(() => undefined);
  };
  if (!entries.length) return { tools, assertReady, close };
  try {
    signal.throwIfAborted();
    if (entries.some((entry) => entry.resources))
      throw new Error(
        "Local MCP resources are not supported by this tool slice.",
      );
    const paths = await installedModulePaths(installedRoot, entries);
    signal.throwIfAborted();
    temporary = await mkdtemp(join(agentDir, "mcp-"));
    signal.addEventListener("abort", abort, { once: true });
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted();
      if (invalid) throw new Error();
      const transport = new StdioTransport({
        command: process.execPath,
        args: [paths[index]!, ...entry.args],
        cwd,
        inheritEnv: false,
        env: {
          HOME: temporary,
          TMPDIR: temporary,
          PATH: "/usr/local/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        stderr: "pipe",
        maxMessageBytes: 262144,
        maxStderrBytes: 8192,
        closeTimeoutMs: 250,
      });
      const client = new McpClient({
        name: "rex",
        version: "0.0.0",
        requestTimeoutMs: 5000,
        roots: [{ uri: pathToFileURL(cwd).href, name: "workspace" }],
      });
      connections.push({ client, transport });
      client.onNotification("notifications/tools/list_changed", () => {
        invalid = true;
      });
      client.onError(() => {
        invalid = true;
        abort();
      });
      client.onClose(() => {
        invalid = true;
      });
      await client.connect(transport);
      signal.throwIfAborted();
      const offered = client.serverCapabilities?.tools
        ? await client.listTools({ signal })
        : [];
      if (
        offered.length !== entry.tools.length ||
        new Set(offered.map((tool) => tool.name)).size !== offered.length ||
        offered.some((tool) => !entry.tools.includes(tool.name))
      )
        throw new Error();
      const names = localMcpToolNames([entry]);
      for (const [toolIndex, rawName] of entry.tools.entries()) {
        const tool = offered.find((tool) => tool.name === rawName)!;
        if (!tool.inputSchema || tool.inputSchema.type !== "object")
          throw new Error();
        tools.push({
          name: names[toolIndex]!,
          label: `${entry.id}/${rawName}`,
          description: tool.description ?? `Local MCP tool ${rawName}`,
          parameters: Type.Unsafe({
            ...tool.inputSchema,
            properties: tool.inputSchema.properties ?? {},
          }),
          async execute(_id, params, callSignal) {
            assertReady();
            const requestSignal = callSignal
              ? AbortSignal.any([signal, callSignal])
              : signal;
            let failure =
              "Local MCP tool failed or returned invalid data; earlier actions may have completed.";
            try {
              const result = await client.callTool(
                rawName,
                params as Record<string, unknown>,
                { signal: requestSignal, timeoutMs: 5000 },
              );
              if (Buffer.byteLength(JSON.stringify(result)) > 65536) {
                failure =
                  "Local MCP result exceeds its bound; earlier actions may have completed.";
                throw new Error();
              }
              return {
                content: toLlmContent(result),
                details: undefined,
                isError: result.isError === true,
              };
            } catch {
              abort();
              throw new Error(failure);
            }
          },
        });
      }
    }
    assertReady();
    return { tools, assertReady, close };
  } catch {
    await close();
    signal.throwIfAborted();
    throw new Error(
      "Local MCP connection failed or its installed definition is invalid.",
    );
  }
}
