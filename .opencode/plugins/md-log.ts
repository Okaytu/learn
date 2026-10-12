/**
 * md-log for OpenCode — mirrors the session into the note linked with
 * `/md-log <note.md>` (see scripts/md-log.mjs), so lessons read rendered in
 * Obsidian. Shares state (.learn/md-log.json) and formatting with the Claude
 * Code hook through scripts/md-log-core.mjs.
 *
 *   - session.idle         flush the turn's prompts and prose
 *   - question tool before write the question before the learner answers
 *   - question tool after  write the learner's answer
 *
 * Subagent sessions (researcher, makers) are never logged.
 */

import type { Plugin } from "@opencode-ai/plugin"
// @ts-ignore — plain JS module shared with the Claude Code hook
import { answerBlock, append, claim, questionBlocks, saveState, tutorBlock, userBlock } from "../../scripts/md-log-core.mjs"

const ASK_TOOL = "question"

export const MdLog: Plugin = async ({ client }) => {
  const topLevel = new Map<string, boolean>()

  async function isTopLevel(id: string) {
    if (!topLevel.has(id)) {
      const res = await client.session.get({ path: { id } })
      topLevel.set(id, !res.data?.parentID)
    }
    return topLevel.get(id)!
  }

  /** Append everything in the session not yet in the note. Returns the state, or null when not logging. */
  async function sync(sessionID: string) {
    if (!(await isTopLevel(sessionID))) return null
    const state = claim(sessionID)
    if (!state) return null

    const res = await client.session.messages({ path: { id: sessionID } })
    const written = new Set<string>(state.written)
    const blocks: string[] = []

    for (const { info, parts } of res.data ?? []) {
      if (info.role === "user") {
        const fresh = parts.filter((p) => p.type === "text" && !p.synthetic && !written.has(p.id))
        const text = fresh.map((p) => (p.type === "text" ? p.text : "")).join("\n")
        fresh.forEach((p) => written.add(p.id))
        if (text.trim()) blocks.push(userBlock(text))
        continue
      }

      let prose: string[] = []
      const flush = () => {
        if (prose.length) blocks.push(tutorBlock(prose.join("\n\n")))
        prose = []
      }
      for (const p of parts) {
        if (p.type === "text" && !p.synthetic && !written.has(p.id) && (!p.time || p.time.end)) {
          if (p.text.trim()) prose.push(p.text.trim())
          written.add(p.id)
        }
        if (p.type === "tool" && p.tool === ASK_TOOL) {
          const q = `${p.callID}:q`
          const a = `${p.callID}:a`
          if (!written.has(q)) {
            flush()
            blocks.push(...questionBlocks(p.state.input))
            written.add(q)
          }
          if (p.state.status === "completed" && !written.has(a)) {
            flush()
            blocks.push(answerBlock(p.state.metadata?.answers ?? p.state.output))
            written.add(a)
          }
        }
      }
      flush()
    }

    state.written = [...written]
    append(state, blocks)
    saveState(state)
    return state
  }

  async function safely(fn: () => Promise<void>) {
    try {
      await fn()
    } catch {
      // Logging must never break the session.
    }
  }

  return {
    event: async ({ event }) =>
      safely(async () => {
        if (event.type === "session.idle") await sync(event.properties.sessionID)
      }),

    "tool.execute.before": async (input, output) =>
      safely(async () => {
        if (input.tool !== ASK_TOOL) return
        const state = await sync(input.sessionID)
        const key = `${input.callID}:q`
        if (!state || state.written.includes(key)) return
        append(state, questionBlocks(output.args))
        state.written.push(key)
        saveState(state)
      }),

    "tool.execute.after": async (input, output) =>
      safely(async () => {
        if (input.tool !== ASK_TOOL) return
        const state = await sync(input.sessionID)
        const key = `${input.callID}:a`
        if (!state || state.written.includes(key)) return
        append(state, [answerBlock(output.metadata?.answers ?? output.output)])
        state.written.push(key)
        saveState(state)
      }),
  }
}
