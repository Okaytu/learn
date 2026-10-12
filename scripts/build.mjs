#!/usr/bin/env node
/**
 * build — generate the Claude Code and OpenCode agent files from one source.
 *
 *   node scripts/build.mjs          write the generated files
 *   node scripts/build.mjs --check  exit 1 if any generated file is stale
 *
 * Edit the prompts in src/ and the per-harness settings below, never the
 * generated files. Skills need no build step: OpenCode reads .claude/skills/
 * directly.
 *
 * Models: Claude Code agents name a model alias. OpenCode agents name none,
 * so subagents inherit whatever model the session runs (e.g. Muse Spark
 * picked with /models). Set `model` under `opencode` to pin one.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const RENDER_ONLY_BASH = { "*": "deny", "node scripts/render.mjs *": "allow" }

const AGENTS = [
  {
    name: "researcher",
    description: "Web researcher. Searches the web and returns a focused, well-sourced brief. Use to verify any fact you are not sure of before teaching it, and to scope a topic before planning a lesson.",
    claude: { tools: "WebSearch, WebFetch", model: "sonnet" },
    opencode: { permission: { edit: "deny", bash: "deny", webfetch: "allow", websearch: "allow" } },
  },
  {
    name: "mermaid-maker",
    description: "Authors ONE Mermaid diagram from a brief, renders it to a PNG, LOOKS at the result, iterates until it is correct and clean, publishes the PNG into the Obsidian vault, and returns the filename. For structural/relational visuals: dependency graphs, flows, sequences, state machines, trees, ER, timelines.",
    claude: { tools: "Read, Write, Edit, Bash", model: "sonnet" },
    opencode: { permission: { edit: "allow", bash: RENDER_ONLY_BASH, webfetch: "deny" } },
  },
  {
    name: "svg-maker",
    description: "Authors ONE hand-written SVG from a brief, renders it to a PNG, LOOKS at the result, iterates until it is correct and clean, publishes the PNG into the Obsidian vault, and returns the filename. For spatial/geometric visuals Mermaid can't express: coordinate geometry, number lines, vectors, function plots, physical layouts.",
    claude: { tools: "Read, Write, Edit, Bash", model: "sonnet" },
    opencode: { permission: { edit: "allow", bash: RENDER_ONLY_BASH, webfetch: "deny" } },
  },
]

const MENTOR = {
  description: "Learn while building: does the task, explains the why, leaves one small piece for you to write, and recaps what just happened.",
}

// ── tiny YAML writer (strings, numbers, booleans, nested maps) ──────────────

function scalar(v) {
  if (typeof v !== "string") return String(v)
  return /^[\w ,./()-]+$/.test(v) && !/^(true|false|null|\d)/.test(v) ? v : JSON.stringify(v)
}

function yaml(obj, indent = "") {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const key = /^[\w-]+$/.test(k) ? k : JSON.stringify(k)
      return v && typeof v === "object" ? `${indent}${key}:\n${yaml(v, indent + "  ")}` : `${indent}${key}: ${scalar(v)}`
    })
    .join("\n")
}

function doc(frontmatter, body, source) {
  return `---\n${yaml(frontmatter)}\n---\n\n<!-- Generated from ${source} by scripts/build.mjs. Edit the source, then run: npm run build -->\n\n${body.trim()}\n`
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const outputs = new Map()
for (const a of AGENTS) {
  const src = `src/agents/${a.name}.md`
  const body = read(src)
  outputs.set(`.claude/agents/${a.name}.md`, doc({ name: a.name, description: a.description, ...a.claude }, body, src))
  outputs.set(`.opencode/agents/${a.name}.md`, doc({ description: a.description, mode: "subagent", ...a.opencode }, body, src))
}
const mentor = read("src/mentor.md")
outputs.set(".claude/output-styles/mentor.md", doc({ name: "Mentor", description: MENTOR.description, "keep-coding-instructions": true }, mentor, "src/mentor.md"))
outputs.set(".opencode/agents/mentor.md", doc({ description: MENTOR.description, mode: "primary" }, mentor, "src/mentor.md"))

const check = process.argv.includes("--check")
let stale = 0
for (const [rel, content] of outputs) {
  const abs = path.join(ROOT, rel)
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null
  if (current === content) continue
  stale++
  if (check) {
    console.log(`stale: ${rel}`)
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, "utf8")
    console.log(`wrote ${rel}`)
  }
}
if (check && stale) {
  console.log("Run `npm run build` to regenerate.")
  process.exit(1)
}
if (!stale) console.log("Generated files are up to date.")
