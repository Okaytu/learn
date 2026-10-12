#!/usr/bin/env node
/**
 * render — turn a Mermaid (.mmd) or SVG (.svg) source into a PNG for the
 * diagram makers' render-and-inspect loop. Shared by Claude Code and OpenCode.
 *
 *   node scripts/render.mjs .learn/work/<name>.mmd                  preview → .learn/preview/<name>.png
 *   node scripts/render.mjs .learn/work/<name>.svg --publish <slug> publish → viz/viz-<slug>-<timestamp>.png
 *
 * Previews stay in .learn/ (hidden from Obsidian); only a published PNG lands
 * in viz/, where Obsidian resolves ![[viz-...png]] embeds by filename.
 *
 * Mermaid: @mermaid-js/mermaid-cli (local install, else npx) with a found
 * Chrome/Chromium, else puppeteer's own browser.
 * SVG: rsvg-convert, then ImageMagick, then the puppeteer that mermaid-cli
 * brings along.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PREVIEW_DIR = path.join(ROOT, ".learn", "preview")
const VIZ_DIR = path.join(ROOT, "viz")
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
const ENV = { ...process.env, PATH: [process.env.PATH, ...EXTRA_PATH].join(path.delimiter), PUPPETEER_SKIP_DOWNLOAD: "1" }

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
]

function fail(msg) {
  console.error(`RENDER FAILED\n${msg}`)
  process.exit(1)
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (!c || !fs.existsSync(c)) continue
    const stat = fs.statSync(c)
    if (stat.isFile()) return c
    // Playwright layout: a directory holding the real binary.
    for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      if (fs.existsSync(path.join(c, sub))) return path.join(c, sub)
    }
  }
  return undefined
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { env: ENV, encoding: "utf8", timeout: 120_000, shell: process.platform === "win32" })
  return { ok: res.status === 0, out: `${res.stderr ?? ""}${res.stdout ?? ""}${res.error ? String(res.error) : ""}` }
}

function renderMermaid(src, out) {
  const chrome = findChrome()
  const cfg = path.join(PREVIEW_DIR, "puppeteer.json")
  fs.writeFileSync(cfg, JSON.stringify({ ...(chrome ? { executablePath: chrome } : {}), args: ["--no-sandbox"] }))
  const local = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc")
  const args = ["-i", src, "-o", out, "-p", cfg, "-s", "2", "-b", "white", "-q"]
  const res = fs.existsSync(local) ? run(local, args) : run("npx", ["-y", "@mermaid-js/mermaid-cli@11", ...args])
  if (!res.ok || !fs.existsSync(out)) fail(res.out.split("\n").slice(-30).join("\n"))
}

async function renderSvgWithPuppeteer(src, out) {
  let puppeteer
  try {
    puppeteer = (await import("puppeteer")).default
  } catch {
    return false
  }
  const chrome = findChrome()
  const browser = await puppeteer.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ["--no-sandbox"] })
  try {
    const page = await browser.newPage()
    await page.setContent(`<body style="margin:0;background:white">${fs.readFileSync(src, "utf8")}</body>`)
    const svg = await page.$("svg")
    if (!svg) return false
    const box = await svg.boundingBox()
    await page.setViewport({ width: Math.ceil(box.width), height: Math.ceil(box.height), deviceScaleFactor: 2 })
    await svg.screenshot({ path: out, omitBackground: false })
    return true
  } finally {
    await browser.close()
  }
}

async function renderSvg(src, out) {
  const errors = []
  for (const [cmd, args] of [
    ["rsvg-convert", ["-z", "2", "-b", "white", src, "-o", out]],
    ["magick", ["-density", "192", "-background", "white", src, out]],
  ]) {
    const res = run(cmd, args)
    if (res.ok && fs.existsSync(out)) return
    errors.push(`${cmd}: ${res.out.trim().split("\n").slice(-5).join("\n")}`)
  }
  if (await renderSvgWithPuppeteer(src, out)) return
  fail(`${errors.join("\n")}\nInstall librsvg (rsvg-convert) or run \`npm install\` in the project root.`)
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "viz"
}

const args = process.argv.slice(2)
const pubAt = args.indexOf("--publish")
const slug = pubAt >= 0 ? args[pubAt + 1] : undefined
const src = args.find((_a, i) => pubAt < 0 || (i !== pubAt && i !== pubAt + 1))
if (!src || (pubAt >= 0 && !slug)) fail("Usage: node scripts/render.mjs <file.mmd|file.svg> [--publish <slug>]")
const abs = path.resolve(src)
if (!fs.existsSync(abs)) fail(`No such file: ${abs}`)

fs.mkdirSync(PREVIEW_DIR, { recursive: true })
const preview = path.join(PREVIEW_DIR, `${path.basename(abs, path.extname(abs))}.png`)
fs.rmSync(preview, { force: true })

const ext = path.extname(abs).toLowerCase()
if (ext === ".mmd" || ext === ".mermaid") renderMermaid(abs, preview)
else if (ext === ".svg") await renderSvg(abs, preview)
else fail(`Unsupported source type: ${ext} (use .mmd or .svg)`)

if (slug) {
  fs.mkdirSync(VIZ_DIR, { recursive: true })
  const filename = `viz-${slugify(slug)}-${Date.now()}.png`
  fs.copyFileSync(preview, path.join(VIZ_DIR, filename))
  console.log(`PUBLISHED\nfilename: ${filename}\npath: ${path.join(VIZ_DIR, filename)}\nLook at the image once more before returning it.`)
} else {
  console.log(`PREVIEW\n${preview}\nOpen this PNG with your read tool and LOOK at it before deciding it's done.`)
}
