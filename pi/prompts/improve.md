---
description: Run the self-improvement loop — diagnose benchmark weaknesses and propose code changes.
args: [history]
section: Meta-Evolution
topLevelCli: true
---
Run the Keating self-improvement pipeline.

If the argument is "history", show the improvement attempt archive:
- Run `/improve history` and display the result.

Otherwise, generate a new improvement proposal:

1. Run `/improve` to diagnose benchmark weaknesses and generate a proposal.
2. Read the proposal file under `.keating/outputs/improvements/`.
3. The proposal contains:
   - A ranked list of diagnosed weaknesses (from benchmark traces).
   - Specific target files that may be modified.
   - Structured instructions for what to change and why.
   - Safety rules: which files are mutable vs immutable.

4. Execute the proposed changes:
   - Only modify files listed in the proposal's `targets`.
   - Never modify: `self-improve.ts`, `types.ts`, `config.ts`, `paths.ts`, `random.ts`.
   - Before each edit, explain what you are changing and why.
   - Keep changes minimal and focused on the diagnosed weakness.

5. After making changes, run the benchmark to evaluate:
   - `keating bench` to get the new score.
   - Compare against the before-score in the proposal.
   - If the score improved or held steady, the change is accepted.
   - If the score dropped, revert your changes.

6. Report the outcome: what changed, before/after scores, and whether the change was kept or rolled back.

Safety contract:
- The self-improvement loop modifies teaching logic (lesson plans, benchmark weights, animations, topic definitions, maps, policy defaults).
- It never modifies the improvement engine itself, type definitions, configuration, or the random seed system.
- Every attempt is archived with snapshots so changes can always be rolled back.
