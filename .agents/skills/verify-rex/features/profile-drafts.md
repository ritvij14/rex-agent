# Profile drafts and admission

A builder may save a new validated draft, but only an operator may activate the reviewed version. The ordinary agent cannot modify active definitions or approve itself.

## Preconditions and entry points

The agent entry is a `profile: profile-builder` request using `propose_profile`. Operator entries are `npm run sandbox -- review-profile ID` and `npm run sandbox -- approve-profile ID DIGEST`. These normal commands target private runtime state; do not use them for an automated check. Disposable synthetic tests use unused invented IDs and owned volumes.

## Repeatable checks

- Run `node --import tsx --test packages/pi-profiles/tests/adapter.test.ts` for an actual builder tool loop, validation, model inheritance, digest review and admission rejection cases.
- Run `npm run verify -- sandbox` for a real agent-side read-only definition mount, failed agent-side approval, the isolated networkless operator helper, exact digest admission and persistence across recreation.

## Expected observations

Draft creation writes only the new proposal; lookup of that ID among active profiles still fails. Review yields the canonical digest. A wrong digest, malformed draft or reused ID fails without overwriting a profile. After the separately simulated operator approval, lookup succeeds and survives container recreation.

Observe the active definitions, not the model's claim that a profile was created. The helper has no inference socket, credentials, workspace, agent state or external network. These checks use synthetic operator authority only; they do not authorize activation in the normal sandbox.

## Gotchas and coverage limits

The container baseline creates its synthetic proposal through the public proposal API; the builder's tool use is covered by SDK integration tests. Changes to the full CLI-to-builder-to-approval journey require extending that user path. Proposals are not protected from every filesystem-capable profile; digest-bound review protects the version approved. Existing-profile updates are not implemented. Do not edit a broken draft or weaken its permissions merely to make admission pass.
