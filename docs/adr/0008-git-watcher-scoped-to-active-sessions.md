# Git watching is scoped to active sessions, not repo-wide docs intelligence

For any repo with a live Agent Session, Loopwatch independently watches git / working-tree state — diff size, files changed, commits, test/check results — as **corroborating evidence** for convergence detection. This independent ground truth is essential: a drifting agent's self-report is precisely the evidence that can't be trusted, and some sources (Pi) don't even record the branch in their transcript.

Loopwatch deliberately does **not** crawl repos for documentation drift, watch inactive repos, or become broad "docs intelligence." The watcher is scoped to active sessions and convergence-relevant signals only.

## Rationale

Independent evidence is the whole point of convergence detection — but an unscoped repo/docs watcher is a different, sprawling product. Scoping to active sessions keeps the signal high and the surface small. The explicit "no docs-drift intelligence" is recorded here to stop the scope being reopened later.
