#!/usr/bin/env node
/**
 * md-log — mirror a learning session into a markdown note for Obsidian.
 *
 *   node scripts/md-log.mjs link <note.md>   link a note (created if missing); the session backfills into it
 *   node scripts/md-log.mjs unlink           stop logging
 *   node scripts/md-log.mjs status           show the linked note
 *   node scripts/md-log.mjs hook             Claude Code hook entry point (reads hook JSON on stdin)
 *
 * The OpenCode side lives in .opencode/plugins/md-log.ts and shares state and
 * formatting through md-log-core.mjs.
 *
 * Claude Code wiring (.claude/settings.json): the same `hook` command runs on
 * PreToolUse/PostToolUse for AskUserQuestion (so a question appears in the
 * note before the learner answers it, and the answer right after) and on Stop
 * (to flush the turn's prose). Each run reads the session transcript from
 * where the previous run stopped.
 */

import fs from "node:fs"
import { answerBlock, append, claim, link, loadState, questionBlocks, saveState, tutorBlock, unlink, userBlock } from "./md-log-core.mjs"

const ASK_TOOL = "AskUserQuestion"

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

function userText(entry) {
  const content = entry.message?.content
  if (typeof content === "string") return content
  if (Array.isArray(content) && !content.some((c) => c.type === "tool_result")) {
    return content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
  }
  return null
}

// Slash commands are stored as tags; show them the way the learner typed them.
function prettyCommand(text) {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]
  if (!name) return /^<local-command-|^<command-message>/.test(text.trim()) ? "" : text
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? ""
  return `${name.trim()} ${args.trim()}`.trim()
}

function toolResultText(block) {
  const c = block.content
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.filter((x) => x.type === "text").map((x) => x.text).join("\n")
  return ""
}

/** Render transcript lines from state.cursor onward into the note. Mutates state. */
function sync(state, transcriptPath) {
  let raw
  try {
    raw = fs.readFileSync(transcriptPath, "utf8")
  } catch {
    return
  }
  const lines = raw.split("\n")
  const written = new Set(state.written)
  const askIds = new Set(state.askIds ?? [])
  const blocks = []
  let prose = []
  const flush = () => {
    if (prose.length) blocks.push(tutorBlock(prose.join("\n\n")))
    prose = []
  }

  let i = state.cursor
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    let entry
    try {
      entry = JSON.parse(lines[i])
    } catch {
      break // Partially written last line: pick it up next run.
    }
    if (entry.isSidechain || entry.isMeta) continue

    if (entry.type === "user") {
      const text = userText(entry)
      if (text != null) {
        if ((entry.origin?.kind ?? "human") !== "human") continue
        const shown = prettyCommand(text)
        if (!shown.trim()) continue
        flush()
        blocks.push(userBlock(shown))
        continue
      }
      for (const block of entry.message?.content ?? []) {
        if (block.type !== "tool_result" || !askIds.has(block.tool_use_id)) continue
        const key = `${block.tool_use_id}:a`
        if (written.has(key)) continue
        flush()
        blocks.push(answerBlock(entry.toolUseResult ?? toolResultText(block)))
        written.add(key)
      }
      continue
    }

    if (entry.type === "assistant") {
      for (const block of entry.message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) prose.push(block.text.trim())
        if (block.type === "tool_use" && block.name === ASK_TOOL) {
          askIds.add(block.id)
          const key = `${block.id}:q`
          if (written.has(key)) continue
          flush()
          blocks.push(...questionBlocks(block.input))
          written.add(key)
        }
      }
    }
  }
  flush()

  state.cursor = i
  state.written = [...written]
  state.askIds = [...askIds]
  append(state, blocks)
}

function hook() {
  let input
  try {
    input = JSON.parse(readStdin())
  } catch {
    return
  }
  const state = claim(input.session_id)
  if (!state || !input.transcript_path) return

  sync(state, input.transcript_path)

  // Write the question/answer straight from the hook payload when the
  // transcript doesn't have it yet, so the note stays live.
  const id = input.tool_use_id
  if (input.tool_name === ASK_TOOL && id) {
    const event = input.hook_event_name
    const key = event === "PreToolUse" ? `${id}:q` : event === "PostToolUse" ? `${id}:a` : null
    if (key && !state.written.includes(key)) {
      append(state, event === "PreToolUse" ? questionBlocks(input.tool_input) : [answerBlock(input.tool_response)])
      state.written.push(key)
      state.askIds = [...new Set([...(state.askIds ?? []), id])]
    }
  }
  saveState(state)
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === "link") {
    if (!rest[0]) throw new Error("Usage: md-log.mjs link <note.md>")
    console.log(`Linked ${link(rest.join(" "))}. The session will be backfilled into it at the end of this turn.`)
  } else if (cmd === "unlink") {
    const target = unlink()
    console.log(target ? `Unlinked ${target}.` : "No note was linked.")
  } else if (cmd === "status") {
    const { target } = loadState()
    console.log(target ? `Logging to ${target}` : "No note linked.")
  } else if (cmd === "hook") {
    hook()
  } else {
    console.log("Usage: md-log.mjs link <note.md> | unlink | status | hook")
  }
} catch (err) {
  // A logging failure must never break the agent's turn when running as a hook.
  if (cmd === "hook") process.exit(0)
  console.error(String(err.message ?? err))
  process.exit(1)
}
