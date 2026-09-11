---
name: stuck
description: Break out of a repeated failed fix. Use when the same error has survived two or more attempts.
---

# When two fixes have failed

Stop editing. A third guess is worse than a first diagnosis.

1. State the exact error, verbatim.
2. State what you believed was wrong, and what the last fix should have changed.
3. State what actually changed. If nothing changed, say so — that is the most useful fact available.
4. Write the smallest reproduction that still fails.
5. List two or three candidate causes, and say which single observation would distinguish between them.
6. Go and make that observation before editing anything.

If the answer is still unclear, say so and hand back. Do not keep going.

Report the diagnosis to the user before applying a fix.