# Security and private information

## Report privately

Do not open a public issue containing a secret, personal memory, client name, account identifier, or transcript. Use GitHub's **Security → Advisories → Report a vulnerability** when private vulnerability reporting is enabled. If that button is unavailable, open only a content-free request for a private contact route. Do not include the findings. Do not assume this repository is continuously monitored or production-ready.

## If something private was published

1. Stop pushes, releases, screenshots, and automated sharing. Do not copy the leak into public issue comments, CI logs, or an AI conversation.
2. Revoke or rotate an exposed credential immediately. Deleting a file is not revocation.
3. Identify affected commits, branches, tags, PRs, issues, workflow logs, artifacts, releases, packages, and forks. Retain a minimal private incident record outside Git.
4. Agree on removal with the owner. History rewriting and visibility changes require explicit approval. For cached views or PR refs, GitHub Support may be needed.
5. Re-run checks and add a synthetic regression test. Assume already-public material may have been copied; no cleanup can promise to make those copies disappear.

## Security boundaries

Git ignore rules, hooks, and scanners prevent some accidents. They do not protect a machine against malicious code, recognize every private fact, or stop someone with permission from bypassing local checks. CI catches mistakes only **after upload**. Agent runtime authorization, sandboxing, and memory isolation remain future work with separate acceptance tests. No real authentication material is needed for repo checks.
