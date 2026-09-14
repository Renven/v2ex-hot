// 抓取 V2EX「最热」tab，按北京时间日期存为 data/hot/YYYY-M-D.json
import * as cheerio from 'cheerio'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = 'data/hot'

// 北京时间日期；Actions 延迟跨过零点时，06:00 前归到前一天
function beijingDay() {
  const t = new Date(Date.now() + 8 * 3600e3)
  if (t.getUTCHours() < 6) t.setUTCDate(t.getUTCDate() - 1)
  return `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`
}

const res = await fetch('https://www.v2ex.com/?tab=hot', {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; v2ex-hot)' },
})
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const $ = cheerio.load(await res.text())

const list = []
$("div[class='cell item']").each(function () {
  const link = $(this).find('.topic-link')
  if (!link.length) return
  const topicInfo = $(this).find('.topic_info')
  const strong = topicInfo.find('strong')
  const date = topicInfo.find('span[title]')
  const node = topicInfo.find('.node')
  list.push({
    id: Number(link.attr('href').match(/\/t\/(\d+)/)[1]),
    title: link.text(),
    replyCount: Number($(this).find('.count_livid').text()) || 0,
    avatar: $(this).find('.avatar').attr('src'),
    username: $(strong[0]).text(),
    lastReplyUsername: strong.length > 1 ? $(strong[1]).text() : undefined,
    lastReplyDateAgo: date.text() || undefined,
    lastReplyDate: date.attr('title')?.replace(' +08:00', ''),
    nodeTitle: node.text() || undefined,
    nodeUrl: node.attr('href')?.replace('/go/', ''),
    isTop: Boolean($(this).attr('style')),
  })
})

// 页面结构变了或被拦截时直接失败，避免静默写出空文件
if (!list.length) throw new Error('未解析到任何帖子')

// 同一天重复运行时直接覆盖，以最后一次（每晚 22:00）为准
const file = path.join(DATA_DIR, `${beijingDay()}.json`)
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(file, JSON.stringify(list))

console.log(`${file}: ${list.length} 条`)
