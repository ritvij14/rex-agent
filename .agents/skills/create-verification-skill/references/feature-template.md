# Feature entry shape

Use this shape for an actual implemented capability. Replace the descriptions with exact repository-derived commands and observations; do not leave placeholders in the runnable map.

## User goal

Describe what a user can accomplish, without private helper names or planned behavior.

## Preconditions and entry points

Identify synthetic starting state, permissions, actual user interfaces and how to confirm the right build is ready. State separately any live-resource approval needed.

## Repeatable checks

Give exact commands and the user action each drives. Reuse existing automation where possible. For multiple entry points, distinguish which were exercised; internal API coverage is not automatically CLI/UI coverage.

## Expected observations

Pair actions with visible and persisted outcomes, including relevant failure, rejection, interruption, repeated/concurrent work and restart behavior. Explain what separate read-back establishes the effect. Expected results come from the intended behavior, not from copying today's output.

## Gotchas and coverage limits

Record unavailable prerequisites, unsupported automation and known product defects. Include safe cleanup and retained evidence locations. Never describe a skipped or blocked path as verified through a different route.
