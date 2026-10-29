import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  McpClient,
  McpError,
  JSON_RPC_ERROR_CODES,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type CallToolResult,
  type McpTransport,
} from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  localMcpToolNames,
  type LocalMcpServer,
  type RemoteMcpServer,
} from "@rex/profiles";
import { installedModulePaths } from "./installed-modules.ts";

interface ManagedEntry {
  readonly id: string;
  readonly tools: readonly string[];
  readonly resources: boolean;
  readonly exposure?: "direct" | "codemode" | "deferred";
}

const isRemote = (
  entry: LocalMcpServer | RemoteMcpServer,
): entry is RemoteMcpServer => Object.hasOwn(entry, "url");

export async function openMcpSession(
  entries: readonly (LocalMcpServer | RemoteMcpServer)[],
  options: {
    installedRoot: string | undefined;
    remoteOrigin: string | undefined;
    cwd: string;
    agentDir: string;
    signal: AbortSignal;
  },
) {
  const { installedRoot, remoteOrigin, cwd, agentDir, signal } = options;
  const tools: ToolDefinition[] = [];
  const connections: {
    entry: ManagedEntry;
    client: McpClient;
    transport: McpTransport;
  }[] = [];
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
  const perform = async (
    callSignal: AbortSignal | undefined,
    operation: (requestSignal: AbortSignal) => Promise<CallToolResult>,
  ) => {
    assertReady();
    const requestSignal = callSignal
      ? AbortSignal.any([signal, callSignal])
      : signal;
    let failure =
      "Local MCP request failed or returned invalid data; earlier actions may have completed.";
    try {
      const result = await operation(requestSignal);
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
  };
  const registerEntryTools = async (entry: ManagedEntry, client: McpClient) => {
    const resources = client.serverCapabilities?.resources;
    if (
      entry.resources &&
      (!resources || typeof resources !== "object" || Array.isArray(resources))
    )
      throw new Error();
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
        exposure: entry.exposure ?? "direct",
        namespace: { name: `mcp__${entry.id}`, aliases: [entry.id] },
        description: tool.description ?? `Local MCP tool ${rawName}`,
        parameters: Type.Unsafe({
          ...tool.inputSchema,
          properties: tool.inputSchema.properties ?? {},
        }),
        async execute(_id, params, callSignal) {
          return perform(callSignal, (requestSignal) =>
            client.callTool(rawName, params as Record<string, unknown>, {
              signal: requestSignal,
              timeoutMs: 5000,
            }),
          );
        },
      });
    }
  };
  if (!entries.length) return { tools, assertReady, close };
  try {
    signal.throwIfAborted();
    const local = entries.filter(
      (entry): entry is LocalMcpServer => !isRemote(entry),
    );
    const remote = entries.filter(isRemote);
    if (remote.length && !remoteOrigin)
      throw new Error("The remote MCP connector router is unavailable.");
    if (local.length) {
      const paths = await installedModulePaths(installedRoot, local);
      signal.throwIfAborted();
      temporary = await mkdtemp(join(agentDir, "mcp-"));
      signal.addEventListener("abort", abort, { once: true });
      for (const [index, entry] of local.entries()) {
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
        connections.push({ entry, client, transport });
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
        await registerEntryTools(entry, client);
      }
    }
    for (const entry of remote) {
      signal.throwIfAborted();
      if (invalid) throw new Error();
      const transport = new StreamableHttpTransport({
        url: new URL(`${remoteOrigin}/${entry.id}/mcp`),
        openGetStream: false,
        reconnect: { maxRetries: 0 },
        maxMessageBytes: 262144,
        fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
      });
      const client = new McpClient({
        name: "rex",
        version: "0.0.0",
        requestTimeoutMs: 5000,
      });
      connections.push({ entry, client, transport });
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
      await registerEntryTools(entry, client);
    }
    const resourceServers = connections.filter(({ entry }) => entry.resources);
    if (resourceServers.length) {
      const server = Type.String({ minLength: 1, maxLength: 64 });
      const visible = (item: {
        name: string;
        title?: string;
        description?: string;
        mimeType?: string;
      }) => ({
        name: item.name,
        title: item.title,
        description: item.description,
        mimeType: item.mimeType,
      });
      for (const name of [
        "list_mcp_resources",
        "list_mcp_resource_templates",
        "read_mcp_resource",
      ] as const) {
        tools.push({
          name,
          label: name,
          description: `Use one explicit selected server (${resourceServers.map(({ entry }) => entry.id).join(", ")}). Lists return one page.`,
          parameters:
            name === "read_mcp_resource"
              ? Type.Object(
                  {
                    server,
                    uri: Type.String({ minLength: 1, maxLength: 2048 }),
                  },
                  { additionalProperties: false },
                )
              : Type.Object(
                  {
                    server,
                    cursor: Type.Optional(Type.String({ maxLength: 2048 })),
                  },
                  { additionalProperties: false },
                ),
          async execute(_id, params, callSignal) {
            const args = params as {
              server: string;
              uri?: string;
              cursor?: string;
            };
            const target = resourceServers.find(
              ({ entry }) => entry.id === args.server,
            );
            if (!target)
              throw new Error(
                "MCP resource server is not selected or authorized.",
              );
            return perform(callSignal, async (requestSignal) => {
              const options = { signal: requestSignal, timeoutMs: 5000 };
              if (name === "read_mcp_resource") {
                const result = await target.client.readResource(
                  args.uri!,
                  options,
                );
                return {
                  content: result.contents.map((resource) => ({
                    type: "resource" as const,
                    resource,
                  })),
                };
              }
              let page;
              if (name === "list_mcp_resources") {
                const result = await target.client.listResourcesPage(
                  args.cursor,
                  options,
                );
                page = {
                  server: target.entry.id,
                  nextCursor: result.nextCursor,
                  resources: result.resources.map((item) => ({
                    ...visible(item),
                    uri: item.uri,
                    size: item.size,
                    server: target.entry.id,
                  })),
                };
              } else {
                let result;
                try {
                  result = await target.client.listResourceTemplatesPage(
                    args.cursor,
                    options,
                  );
                } catch (error) {
                  if (
                    !(error instanceof McpError) ||
                    error.code !== JSON_RPC_ERROR_CODES.methodNotFound
                  )
                    throw error;
                  result = { resourceTemplates: [] };
                }
                page = {
                  server: target.entry.id,
                  nextCursor: result.nextCursor,
                  resourceTemplates: result.resourceTemplates.map((item) => ({
                    ...visible(item),
                    uriTemplate: item.uriTemplate,
                    server: target.entry.id,
                  })),
                };
              }
              return {
                content: [{ type: "text", text: JSON.stringify(page) }],
              };
            });
          },
        });
      }
    }
    assertReady();
    return { tools, assertReady, close };
  } catch (error) {
    await close();
    signal.throwIfAborted();
    throw new Error(
      "Local MCP connection failed or its installed definition is invalid.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
