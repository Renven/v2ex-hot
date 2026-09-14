// 生成 OneTab 导入文本：指定日期的最热帖子，去掉 Firefox 历史里访问过的
//
//   node scripts/unread.js                      今天
//   node scripts/unread.js 3                    最近 3 天（含今天）
//   node scripts/unread.js 2026-9-10            某一天
//   node scripts/unread.js 2026-9-8 2026-9-10   日期区间
//   加 --open：每天在 Firefox 新窗口打开，存进 OneTab 后按回车打开下一天
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import readline from 'node:readline/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RAW = 'https://raw.githubusercontent.com/Renven/v2ex-hot/hot/'
const OUT_DIR = 'out'
const FIREFOX = 'C:/Program Files/Mozilla Firefox/firefox.exe'

const fmt = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function dayList(args) {
  const today = parse(fmt(new Date(Date.now() + 8 * 3600e3)))
  let from = today
  let to = today
  if (args.length === 1 && /^\d+$/.test(args[0])) {
    from = new Date(today - (Number(args[0]) - 1) * 86400e3)
  } else if (args.length >= 1) {
    from = parse(args[0])
    to = parse(args[1] ?? args[0])
  }
  const days = []
  for (let d = from; d <= to; d = new Date(+d + 86400e3)) days.push(fmt(d))
  return days
}

// Firefox 配置目录：FIREFOX_PROFILE 指定，否则取历史库最近有写入的那个
function firefoxProfile() {
  if (process.env.FIREFOX_PROFILE) return process.env.FIREFOX_PROFILE
  const root = path.join(process.env.APPDATA, 'Mozilla/Firefox/Profiles')
  const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)
  return fs
    .readdirSync(root)
    .map((name) => path.join(root, name))
    .map((dir) => {
      const db = path.join(dir, 'places.sqlite')
      return { dir, t: Math.max(mtime(db), mtime(db + '-wal')) }
    })
    .filter((p) => p.t > 0)
    .sort((a, b) => b.t - a.t)[0].dir
}

// Firefox 运行中会锁库，复制到临时目录再读
function visitedIds(profile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2ex-hot-'))
  const db = path.join(tmp, 'places.sqlite')
  fs.copyFileSync(path.join(profile, 'places.sqlite'), db)
  const wal = path.join(profile, 'places.sqlite-wal')
  if (fs.existsSync(wal)) fs.copyFileSync(wal, db + '-wal')

  const conn = new DatabaseSync(db)
  const rows = conn
    .prepare("SELECT url FROM moz_places WHERE visit_count > 0 AND url LIKE '%v2ex.com/t/%'")
    .all()
  conn.close()
  fs.rmSync(tmp, { recursive: true, force: true })

  const ids = new Set()
  for (const { url } of rows) {
    // 只认 v2ex 域名（含 fast. / jp. 等子域），排除 google 跳转链接等
    const m = url.match(/^https?:\/\/([a-z0-9-]+\.)?v2ex\.com\/t\/(\d+)/)
    if (m) ids.add(Number(m[2]))
  }
  return ids
}

const args = process.argv.slice(2)
const open = args.includes('--open')
const days = dayList(args.filter((a) => a !== '--open'))
const profile = firefoxProfile()
const visited = visitedIds(profile)
console.log(`Firefox 配置：${path.basename(profile)}，历史中访问过 ${visited.size} 个帖子`)

const seen = new Set() // 多天去重：帖子只归到第一次上榜的那天
const groups = []
let total = 0
let unreadTotal = 0
for (const day of days) {
  const res = await fetch(`${RAW}${day}.json`)
  if (!res.ok) {
    console.log(`${day}  无数据（HTTP ${res.status}）`)
    continue
  }
  const topics = (await res.json()).filter((v) => !seen.has(v.id))
  topics.forEach((v) => seen.add(v.id))
  const unread = topics.filter((v) => !visited.has(v.id))
  total += topics.length
  unreadTotal += unread.length
  console.log(`${day}  ${topics.length} 条，已看 ${topics.length - unread.length}，未看 ${unread.length}`)
  if (unread.length) {
    groups.push({ day, urls: unread.map((v) => `https://www.v2ex.com/t/${v.id}`), titles: unread.map((v) => v.title) })
  }
}

if (!groups.length) {
  console.log('没有未看的帖子')
  process.exit(0)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const file = path.resolve(OUT_DIR, `unread_${days[0]}_${days.at(-1)}.txt`)
const text = groups.map((g) => g.urls.map((u, i) => `${u} | ${g.titles[i]}`).join('\n')).join('\n\n')
fs.writeFileSync(file, text + '\n')
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Get-Content -Raw -Encoding UTF8 -LiteralPath '${file}' | Set-Clipboard`,
])
console.log(`合计 ${total} 条，未看 ${unreadTotal} 条 → ${file}（已复制到剪贴板）`)

if (open) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  for (const [i, g] of groups.entries()) {
    // 一次调用内：先开新窗口，其余作为新标签页进入该窗口
    execFileSync(FIREFOX, ['-new-window', g.urls[0], ...g.urls.slice(1).flatMap((u) => ['-new-tab', u])])
    const next = groups[i + 1]
    const hint = next ? `按回车打开 ${next.day}` : '按回车结束'
    await rl.question(`已打开 ${g.day}（${g.urls.length} 个标签页），在该窗口点 OneTab 存为一组后，${hint}`)
  }
  rl.close()
}
