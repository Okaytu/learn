/**
 * md-log core — shared by the Claude Code hook (scripts/md-log.mjs) and the
 * OpenCode plugin (.opencode/plugins/md-log.ts).
 *
 * Mirrors the reading-relevant parts of a session into a markdown note so the
 * lesson can be read rendered in Obsidian (math, code, mermaid, embeds):
 *   - learner prompts
 *   - tutor prose
 *   - question / quiz blocks (the question is written before the learner
 *     answers; the answer is appended afterwards)
 * Every other tool call (bash, read, edit, ...) is left out.
 *
 * State lives in .learn/md-log.json. One note is linked per project, and the
 * first session to fire an event after `link` claims it, so a stray second
 * session can't interleave into the same note. Append-only: linking an
 * existing note never overwrites what's already in it.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STATE_DIR = path.join(ROOT, ".learn")
const STATE_FILE = path.join(STATE_DIR, "md-log.json")

const EMPTY = { target: null, session: null, cursor: 0, written: [] }

export function loadState() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }
  } catch {
    return { ...EMPTY }
  }
}

export function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8")
}

/** Link a note (created if missing). Resets the session claim so the next event backfills. */
export function link(file) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(ROOT, file)
  if (!resolved.endsWith(".md")) throw new Error(`Not a markdown file: ${resolved}`)
  if (fs.existsSync(resolved) && !fs.statSync(resolved).isFile()) throw new Error(`Not a file: ${resolved}`)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  if (!fs.existsSync(resolved)) fs.writeFileSync(resolved, "", "utf8")
  saveState({ ...EMPTY, target: resolved })
  return resolved
}

export function unlink() {
  const { target } = loadState()
  saveState({ ...EMPTY })
  return target
}

/**
 * Decide whether this session may write. Claims the link for the first
 * session that asks; returns null when nothing is linked or another session
 * owns it.
 */
export function claim(sessionId) {
  const state = loadState()
  if (!state.target) return null
  if (state.session && state.session !== sessionId) return null
  if (!state.session) {
    state.session = sessionId
    saveState(state)
  }
  return state
}

export function append(state, blocks) {
  const text = blocks.filter(Boolean).join("\n\n")
  if (!text || !state.target) return
  let current = ""
  try {
    current = fs.readFileSync(state.target, "utf8")
  } catch {
    // Note was deleted externally; recreate it.
  }
  const head = current.trimEnd()
  fs.writeFileSync(state.target, (head ? head + "\n\n" : "") + text + "\n", "utf8")
}

// ── Formatting (Obsidian callouts) ──────────────────────────────────────────

function callout(type, title, bodyLines) {
  return [`> [!${type}] ${title}`, ...bodyLines.map((l) => (l.length === 0 ? ">" : `> ${l}`))].join("\n")
}

// Skill bodies injected into a prompt are context, not learner prose.
function stripInjected(text) {
  return text
    .replace(/<skill\b([^>]*)>[\s\S]*?<\/skill>/g, (_m, attrs) => {
      const name = /name="([^"]+)"/.exec(attrs)?.[1]
      return `> [!note] Skill loaded: ${name ?? "(unknown)"}`
    })
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim()
}

export function userBlock(text) {
  const clean = stripInjected(text)
  return clean ? `> [!quote] YOU\n\n${clean}` : ""
}

export function tutorBlock(text) {
  const clean = text.trim()
  return clean ? `> [!abstract] TUTOR\n\n${clean}` : ""
}

/**
 * Normalize one question from either harness:
 *   Claude Code AskUserQuestion: { question, header, options: [{ label, description }], multiSelect }
 *   OpenCode question:           { question | prompt, header, options | choices, multiple }
 */
function normalizeQuestion(q) {
  const options = (q.options ?? q.choices ?? []).map((o) => (typeof o === "string" ? o : o.label ?? String(o)))
  return {
    header: q.header || "Question",
    question: q.question ?? q.prompt ?? "",
    options,
    multi: Boolean(q.multiSelect ?? q.multiple),
  }
}

/** Question block(s). Never includes the answer — the learner reads the note live. */
export function questionBlocks(input) {
  const list = Array.isArray(input?.questions) ? input.questions : input ? [input] : []
  return list.map(normalizeQuestion).map((q) => {
    const isQuiz = /quiz/i.test(q.header)
    const body = q.question.split("\n")
    if (q.options.length) body.push("", ...q.options.map((o, i) => `${i + 1}. ${o}`))
    if (q.multi) body.push("", "_(select all that apply)_")
    return callout("question", isQuiz ? "Quiz" : q.header, body)
  })
}

/** Answer block from whatever the harness returned (structured answers or plain text). */
export function answerBlock(result) {
  let lines = []
  const answers = result?.answers
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    for (const [question, answer] of Object.entries(answers)) {
      lines.push(Object.keys(answers).length > 1 ? `**${question}** — ${answer}` : String(answer))
    }
  } else if (Array.isArray(answers)) {
    lines = answers.map((a) => (Array.isArray(a) ? a.join(", ") : String(a)))
  } else if (typeof result === "string") {
    lines = result.trim().split("\n")
  } else if (result != null) {
    lines = [JSON.stringify(result)]
  }
  if (lines.length === 0) lines = ["(no answer)"]
  return callout("example", "Your answer", lines)
}
