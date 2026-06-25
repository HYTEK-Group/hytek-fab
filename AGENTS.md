# This is NOT the Next.js you know

This version (16.2.3) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js-specific code. Heed deprecation notices.

# Expert-agent discipline (per Scott's standing directive)

Before non-trivial decisions (schema, state machine, UX flow, offline behaviour, performance):

1. Dispatch 2–4 agents in parallel with distinct lenses:
   - Architect / PhD coder — correctness, failure modes
   - Mathematician — data integrity, invariants, rounding
   - Strategist — business fit, reversibility, sequencing
   - UX efficiency — tap count, thumb-reach, time-to-value
2. Cross-reference outputs before acting. Surface disagreement to Scott.
3. State tap-count for every user-facing screen. >3 taps on a hot path = redesign.
4. No patches. Root-cause or defer with a named follow-up.

Skip the panel for trivial edits (typos, single-line copy changes).
