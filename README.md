# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

An AI learning system for **Claude Code** and **OpenCode** that writes its lessons into **Obsidian**. It's a port of the pi setup from [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU) ([amosblomqvist/learn](https://github.com/amosblomqvist/learn)). The teaching philosophy is unchanged. The pi extensions are replaced by each harness's own tools, plus a few small scripts both harnesses share.

## Two ways to learn

| Mode | Use it when | How |
|---|---|---|
| **Teach** | You want to properly learn a topic | `/teach <topic>`, or just ask to learn something. It probes your level with quizzes, plans a dependency map, then teaches node by node, checking each one |
| **Mentor** | You're building something and want to learn as you go | Claude Code: `/config` → Output style → **Mentor**. OpenCode: press Tab to switch to the **mentor** agent. It does the work, explains the *why*, leaves you one small piece to write, and recaps what just happened |

Both modes write the session into an Obsidian note if you link one (`/md-log`; `/teach` does it for you).

## What's in it

| Piece | What it does | Claude Code | OpenCode |
|---|---|---|---|
| `teach` skill | The philosophy and the probe → plan → teach process | `.claude/skills/teach/` | Same files (OpenCode reads `.claude/skills/`) |
| `visualize` skill | Adds one correct, minimal diagram to a lesson | `.claude/skills/visualize/` | Same files |
| `researcher` | Fact-checks with the web before anything is taught | `.claude/agents/` | `.opencode/agents/` |
| `mermaid-maker`, `svg-maker` | Draw a diagram, render it, *look at it*, fix it, publish it to `viz/` | `.claude/agents/` | `.opencode/agents/` |
| Mentor mode | Learn-while-coding behaviour | `.claude/output-styles/mentor.md` | `.opencode/agents/mentor.md` |
| Quizzes and questions | Popups with options | Built-in `AskUserQuestion` | Built-in `question` tool |
| Lesson log | Mirrors prompts, prose, questions and answers into a note | Hooks in `.claude/settings.json` | Plugin in `.opencode/plugins/md-log.ts` |
| Shared scripts | Rendering and logging used by both | `scripts/render.mjs`, `scripts/md-log.mjs` | Same |

Agent prompts have one source in `src/`. `npm run build` generates the Claude Code and OpenCode versions, so the two never drift apart.

## Setup

Requirements: Node 18+, plus Claude Code and/or OpenCode.

```bash
git clone https://github.com/okaytu/learn my-learning
cd my-learning
npm install          # mermaid-cli, for diagrams
```

1. **Open the folder as an Obsidian vault** (or put it inside your existing vault). Lessons land in `lessons/` and diagrams in `viz/`. Obsidian hides the dot-folders.
2. **Diagrams** need a Chrome or Chromium install (found automatically, or set `PUPPETEER_EXECUTABLE_PATH`). For SVG, also install `librsvg` (`brew install librsvg`, `apt install librsvg2-bin`). Without it, rendering falls back to ImageMagick, then headless Chrome.
3. **Start the agent** in this folder: `claude` or `opencode`.

### OpenCode and Muse Spark

Pick your model with `/models` in OpenCode; it's remembered for next time. The OpenCode agents here don't pin a model, so the researcher and the diagram makers run on whatever model your session uses (Muse Spark included). To pin a model for one agent, set `model` for it under `opencode` in `scripts/build.mjs` and run `npm run build`.

Two things to check:
- **The diagram makers must see images.** They open the rendered PNG to check it. Use a model with image input; Muse Spark lists image input.
- **Free tiers may train on your data.** Third-party reports say the free "Contributor" access to Muse Spark on OpenCode may use your prompts for training ([report](https://select.keenable.ai/r/opencode-go-25-model-price-throughput-capability-guide/JCZU0lc6y3CWlMKZRnGI0Q), [deal post](https://www.mydealz.de/deals/muse-spark-13-kostenlos-nutzbar-uber-opencode-vgb-mit-opus-5-gpt-56-sol-2834571)). That's fine for learning, but don't paste private code into it. Check the current terms on the model's OpenCode page.
- **Web search in OpenCode** works out of the box on the OpenCode/OpenCode Go providers. On other providers, start with `OPENCODE_ENABLE_EXA=1 opencode` so the researcher can search.

## The lesson log

- `/md-log lessons/2026-10-12-tcp.md` links a note (created if missing) and backfills the session into it.
- `/md-unlog` stops logging.
- `/teach` links a note on its own once it knows the topic.

You see each question in the note before you answer it, and your answer right after. Quizzes are marked as quizzes, and the answer is never written into the question. Only the session that was active when you linked writes to the note, and the log only ever appends to it.

## Make it yours

The `teach` skill was written for one learner. Edit `.claude/skills/teach/SKILL.md` to fit how you learn. For the agents and mentor mode, edit `src/`, then run `npm run build` (`npm run check` tells you if the generated files are stale).
