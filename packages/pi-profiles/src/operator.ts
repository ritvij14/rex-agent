import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { approveProposal, reviewProposal } from "./proposals.ts";

async function main() {
  if (process.getuid?.() !== 0) throw new Error();
  const [action, id, digest, ...rest] = process.argv.slice(2);
  if (!id || rest.length) throw new Error();
  const reviewed = await reviewProposal("/proposals", id);
  // The launcher mounts only the builder's proposals, not a model-selected source.
  if (
    reviewed.provenance.origin !== "profile-builder" ||
    reviewed.provenance.operation !== "create"
  )
    throw new Error();
  if (action === "review" && !digest) {
    console.log(JSON.stringify(reviewed, null, 2));
  } else if (action === "approve" && digest) {
    const snapshot = await mkdtemp(join(tmpdir(), "rex-admission-"));
    try {
      const home = join(snapshot, id);
      await mkdir(home);
      const profile = reviewed.definition;
      await writeFile(
        join(home, "profile.json"),
        JSON.stringify(
          profile.configuration
            ? { id, configuration: profile.configuration }
            : {
                version: 2,
                id,
                ...(profile.model ? { model: profile.model } : {}),
                ...(profile.tools ? { tools: profile.tools } : {}),
              },
        ),
      );
      if (profile.soul) await writeFile(join(home, "SOUL.md"), profile.soul);
      await writeFile(
        join(home, "provenance.json"),
        JSON.stringify(reviewed.provenance),
      );
      const result = await approveProposal("/profiles", snapshot, id, digest);
      console.log(`Approved profile: ${result.id}`);
    } finally {
      await rm(snapshot, { recursive: true, force: true });
    }
  } else throw new Error();
}

main().catch(() => {
  console.error(
    "Profile review/approval rejected; require an operator, valid draft, matching digest and unused destination. Private diagnostics omitted.",
  );
  process.exitCode = 1;
});
