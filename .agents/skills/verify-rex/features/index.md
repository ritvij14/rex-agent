# Rex verification map

This map covers implemented user behavior only. Use the affected entries for a change; use all entries for a broad audit. A mapped behavior is an expectation, not evidence that today's run passed it.

| Feature | User goal | Reusable checks |
| --- | --- | --- |
| [Profiles and sessions](profiles-and-sessions.md) | Select a role explicitly, perform allowed work and resume the right conversation | Core/SDK tests; installed CLI synthetic acceptance |
| [Profile drafts](profile-drafts.md) | Propose a profile without granting it authority; require operator admission | SDK proposal/admission tests; isolated operator helper acceptance |
| [Terminal sandbox](terminal-sandbox.md) | Work without host/account access and recover without losing persistent state | Gateway tests; real disposable Docker boundary/recovery checks |

Start with `npm run verify -- doctor`. `npm run verify -- full` records source checks and all existing synthetic container acceptance. The feature entries identify narrower commands and gaps; choosing one does not verify the others.

Select success, rejection, failure, interruption, repeated/concurrent work and persistence cases according to the actual change. After an escaped bug, strengthen the relevant observation and keep the expected user outcome unchanged unless the owner changes it.

Live model compatibility, coding quality and interactive TUI behavior are not established by the fake provider. Routers, memory, model overrides and Durable are not available features. Tool-name policy does not imply filesystem privacy between profiles. No browser is part of this workflow.
