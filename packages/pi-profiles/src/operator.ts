import { approveProposal, reviewProposal } from "./proposals.ts";

async function main() {
  if (process.getuid?.() !== 0) throw new Error();
  const [action, id, digest, ...rest] = process.argv.slice(2);
  if (!id || rest.length) throw new Error();
  if (action === "review" && !digest) {
    console.log(
      JSON.stringify(await reviewProposal("/proposals", id), null, 2),
    );
  } else if (action === "approve" && digest) {
    const result = await approveProposal("/profiles", "/proposals", id, digest);
    console.log(`Approved profile: ${result.id}`);
  } else throw new Error();
}

main().catch(() => {
  console.error(
    "Profile review/approval rejected; require an operator, valid draft, matching digest and unused destination. Private diagnostics omitted.",
  );
  process.exitCode = 1;
});
