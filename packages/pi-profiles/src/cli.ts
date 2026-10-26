import { readdir } from "node:fs/promises";
import { parseProfileRequest } from "@rex/profiles";
import { IncompleteProfileResponseError, runProfileRequest } from "./index.ts";

async function main() {
  const args = process.argv.slice(2);
  let newSession = false;
  let maintain = false;
  while (args[0]?.startsWith("--")) {
    if (args[0] === "--new-session" && !newSession) newSession = true;
    else if (args[0] === "--maintain" && !maintain) maintain = true;
    else throw new Error();
    args.shift();
  }
  if (args.length > 1) throw new Error();
  let input = args[0] ?? "";
  if (!args.length) {
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
    signal: AbortSignal.timeout(90000),
  });
  console.log(`[profile=${result.profileId} model=${result.model}]`);
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
