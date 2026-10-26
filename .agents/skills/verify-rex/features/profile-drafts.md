# Profile drafts and admission

A builder may save a new validated draft, but only an operator may activate the reviewed version. The ordinary agent cannot modify active definitions or approve itself.

## Preconditions and entry points

The agent entry is a `profile: profile-builder` request using `propose_profile`. Operator entries are `npm run sandbox -- review-profile ID` and `npm run sandbox -- approve-profile ID DIGEST`. These normal commands target private runtime state; do not use them for an automated check. Disposable synthetic tests use unused invented IDs and owned volumes.

## Repeatable checks

- Run `node --import tsx --test packages/pi-profiles/tests/adapter.test.ts packages/pi-profiles/tests/admission.test.ts` for an actual builder tool loop, validation, model inheritance, provenance-bound create/update admission, whole-bundle digests and rejection cases.
- Run `npm run verify -- sandbox` for actual builder-tool draft creation in private storage, the read-only selected definition mount, source-bound networkless operator helper, rejected forged update provenance, wrong-digest rejection, exact admission and a successful worker request for the new profile.

## Expected observations

Draft creation writes only the new proposal plus its provenance record; lookup of that ID among active profiles still fails. Review yields the whole-bundle digest and provenance. A wrong digest, stale base revision, changed shared configuration, mismatched origin, malformed provenance or reused ID fails without overwriting a profile. After the separately simulated operator approval, the new profile can run in its own worker. The library consumes writable-root drafts; the installed helper consumes a private temporary snapshot of the read-only source instead. Source drafts remain, but replay still fails on destination vacancy.

Observe the active definitions, not the model's claim that a profile was created. The helper has no inference socket, credentials, workspace, agent state or external network. These checks use synthetic operator authority only; they do not authorize activation in the normal sandbox.

## Gotchas and coverage limits

The installed path binds the origin to the builder's actual volume, not mutable provenance text. Other workers cannot access that volume. The helper currently accepts creation only; library update tests are not proof of installed self-maintenance. Review/approval locks the source profile, then snapshots and validates the exact reviewed content. Tests use only invented operator authority, never normal drafts or active profiles. Do not repair a broken real draft or weaken its permissions to make admission pass.
