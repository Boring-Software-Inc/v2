---
description: Run verdict replay over event history with the working-tree engine, diff verdicts vs stored runs, and output the flip report for human review.
argument-hint: [range]
---

Run a verdict replay over event history using the **working-tree** core engine,
then produce the flip report. This is the CI gate on `core` changes
(`.claude/rules/testing.md`) and a research pipeline.

`[range]` scopes the event window (e.g. a date range, repo, or `last:1000`);
default to a sensible recent window and state what you chose.

The job is real: `bun run replay` (`apps/worker/src/jobs/replay.ts`).

Steps:
1. Full-DB replay: `bun run replay [--limit N] [--out flip-report.json]` —
   loads every stored run (raw event re-normalized with the current
   normalizer, rule envelopes replayed verbatim from stored run_steps, the
   run's own SNAPSHOT re-executed through the current executor + degradation
   floor + resume/deny-floor semantics). Never fetches live GitHub; a node
   whose evaluation wasn't captured replays as skipped (honest degradation).
2. Corpus replay (what CI runs on `packages/core/**` changes,
   `.github/workflows/replay.yml`):
   `bun run replay --corpus apps/worker/fixtures/replay-corpus.json`.
   Refresh the corpus from the DB with `--dump-corpus <path>` when new stored
   runs are worth pinning.
3. The **flip report** prints to stdout (and `--out` writes the JSON
   artifact): run id, old → new verdict, responsible semantics change or
   rule@version, evidence delta. The job fails ONLY on crash, never on flips.
4. Do NOT auto-accept flips — this is for human review. Summarize magnitude
   (how many flipped, which semantics/rules dominate) and stop. An
   UNATTRIBUTED flip is a replay bug or an unshipped finding — investigate
   before any core change ships.
