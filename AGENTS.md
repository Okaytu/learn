# Learning workspace

This folder is a learning workspace, opened both by a coding agent (Claude Code or OpenCode) and by Obsidian. The learner reads lessons rendered in Obsidian.

## How to help here

- When the learner wants to learn, understand, or be quizzed on something, use the `teach` skill and follow it exactly.
- When a lesson idea is clearer as a picture, use the `visualize` skill. Never hand-draw a diagram yourself.
- Never state a fact you're unsure of. Check it first with the `researcher` subagent.

## Layout

- `lessons/`: lesson notes, written only by the md-log mirror (`node scripts/md-log.mjs link <note.md>`). Don't edit a linked note by hand while a session is logging into it.
- `viz/`: published diagrams, written only by the maker subagents through `scripts/render.mjs`. Embed them as `![[<filename>|500]]`.
- `.claude/skills/`: the `teach` and `visualize` skills. OpenCode reads them from here too.
- `src/`: the source of every agent prompt. `.claude/agents/`, `.opencode/agents/` and `.claude/output-styles/` are generated from it. After editing `src/`, run `npm run build`.
- `.learn/`: scratch state (log cursor, diagram drafts, previews). Git-ignored.
