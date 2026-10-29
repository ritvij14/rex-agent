import { readdir, stat } from "node:fs/promises";
import { parseProfileArguments, parseProfileRequest } from "@rex/profiles";
import { IncompleteProfileResponseError, runProfileRequest } from "./index.ts";

async function main() {
  const {
    newSession,
    maintain,
    modelOverride,
    input: argument,
  } = parseProfileArguments(process.argv.slice(2));
  let input = argument ?? "";
  if (argument === null) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 65536) throw new Error();
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString("utf8");
  }
  const { profileId } = parseProfileRequest(input);
  const definitions = (await readdir("/profiles")).filter(
    (id) => id !== "shared",
  );
  if (definitions.length !== 1 || definitions[0] !== profileId)
    throw new Error();
  const result = await runProfileRequest({
    profilesRoot: "/profiles",
    stateRoot: "/state/profiles",
    proposalsRoot: "/proposals",
    cwd: "/workspace",
    baseUrl: "http://127.0.0.1:8317/v1",
    input,
    newSession,
    maintain,
    modelOverride,
    installedExtensionsRoot: "/opt/rex/operator-extensions",
    installedMcpRoot: "/opt/rex/operator-mcp",
    remoteMcpOrigin: (
      await stat("/run/connectors").catch(() => null)
    )?.isDirectory()
      ? "http://127.0.0.1:8400"
      : undefined,
  });
  console.log(`[profile=${result.profileId} model=${result.model}]`);
  if (result.attempts.length > 1)
    console.log(`[model-attempts=${result.attempts.join(",")}]`);
  console.log(result.output);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof IncompleteProfileResponseError
      ? error.message
      : "Profile request failed. Require 'profile: <id>' on the first line and a task; check profile availability, policy, connection and turn lock. Private diagnostics omitted.",
  );
  process.exitCode = 1;
});
