# Session identity follows the source

An Agent Session's identity is the **source's own session boundary**, keyed by `(source, source-native session id)`. One source session is one Loopwatch session — even when the work moves across projects, branches, or worktrees mid-session. Repo, branch, and worktree are recorded as **per-event labels (derived context), not part of identity**. Loopwatch never splits one source session into several, nor stitches several into one.

When the user changes topics (a **Pivot**), Loopwatch *suggests* starting a fresh session but does not redefine the boundary itself.

## Rationale

Trusting the source keeps the model simple and matches exactly what the user sees in the agent. Deriving our own boundaries would invite split-brain between Loopwatch's notion of a session and the agent's, and would shred the convergence narrative whenever an agent legitimately changes directory. Grouping and filtering by repo/branch is a view concern, fully served by labels.
