# V2EX 历史最热：V2Next 的实现方式记录

> 记录时间：2026-09-14
> 目的：V2EX 官方 API 不支持按日期回看「最热」，参考 V2Next 插件的做法，为后续自己实现做准备。

## 1. 结论

V2EX 官方 API（v2 与 v1）都**不支持**按日期查询历史最热：

- API 2.0（`https://www.v2ex.com/api/v2/`，文档 https://edge.v2ex.com/help/api）只有 `topics/latest`、`nodes/:name/topics` 等接口，仅支持分页参数 `p`，无日期、无排序、无「最热」。
- v1 的 `https://www.v2ex.com/api/topics/hot.json` 只返回**当前**热门，无日期参数。

V2Next 的做法：**自己每天定时抓 `https://www.v2ex.com/?tab=hot` 页面，把快照按日期存成 JSON 文件**，插件再按日期读取这些文件。

## 2. 来源

| 部分 | 仓库 / 地址 | 记录时版本 |
|---|---|---|
| 主仓库（仅 submodule 聚合） | https://github.com/zyronon/V2Next | — |
| 采集程序 | https://github.com/zyronon/V2Next-hot（`master` 分支：代码） | `b2d5087` |
| 采集数据 | 同上 `hot` 分支 `public/hot/` | `08886d6` |
| 数据线上地址 | `https://v2hotlist.vercel.app/hot/` | — |
| 油猴脚本 | https://greasyfork.org/zh-CN/scripts/458024（源码 submodule `V2Next-script`） | v10.31 |

已验证：`hot` 分支的 `2026-9-13.json` 与 `v2hotlist.vercel.app/hot/2026-9-13.json` md5 一致，即 Vercel 部署的就是 `hot` 分支。

## 3. 整体流程

```
GitHub Actions（cron 每天一次）
  └─ checkout hot 分支 → pnpm install → node gen.js
       ├─ fetch https://www.v2ex.com/?tab=hot（无登录态）
       ├─ cheerio 解析 HTML → 帖子列表
       ├─ 写 public/hot/YYYY-M-D.json（当天快照，覆盖）
       ├─ 写 public/hot/test-YYYY-M-D-H-M.json（带时分的备份）
       ├─ 汇总生成 3d.json / 7d.json / 30d.json
       └─ 写 map.json（所有日期列表，倒序）
  └─ git commit & push 到 hot 分支
Vercel 部署 hot 分支 → https://v2hotlist.vercel.app/hot/*.json
油猴脚本在「最热」tab 下注入入口 → fetch 对应 JSON → 用 jQuery 渲染成 V2EX 原生列表样式
```

## 4. 采集端实现

### 4.1 定时任务 `.github/workflows/upload-file.yml`

```yaml
on:
  push:
    branches: [master]
  schedule:
    - cron: '30 15 * * *'   # UTC 15:30 = 北京 23:30（原注释误写为 23:50）

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: |
          git fetch origin
          git checkout hot
          git pull origin hot
      - uses: pnpm/action-setup@v2
        with: { version: 8 }
      - uses: actions/setup-node@v3
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm run gen          # node gen.js
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/*
          git commit -m "Add generated files from GitHub Actions"
      - run: git push origin HEAD:hot
```

要点：代码在 `master`，数据在 `hot` 分支，互不干扰；依赖只有 `cheerio`、`node-fetch`。

### 4.2 解析 `gen.js`（核心逻辑）

```js
let res = await fetch('https://www.v2ex.com/?tab=hot')
const $ = cheerio.load(await res.text())

$("div[class='cell item']").each(function () {
  let item_title = $(this).find('.topic-link')
  if (!item_title.length) return
  let item = {}
  item.id = item_title[0].attribs.href.match(/(\d+)/)[0] - 0
  item.title = item_title.text()
  item.replyCount = $(this).find('.count_livid').text() - 0
  item.avatar = $(this).find('.avatar').attr('src')

  let topicInfo = $(this).find('.topic_info')
  let strongList = topicInfo.find('strong')
  item.username = $(strongList[0]).text()
  if (strongList.length > 1) item.lastReplyUsername = $(strongList[1]).text()

  let date = topicInfo.find('span')
  if (date.length) {
    item.lastReplyDateAgo = date.text().replace(' +08:00', '')
    item.lastReplyDate = date.attr('title').replace(' +08:00', '')
  }

  let nodeEl = topicInfo.find('.node')
  if (nodeEl.length) {
    item.nodeTitle = nodeEl.text()
    item.nodeUrl = nodeEl.attr('href').replace('/go/', '')
  }
  // 置顶帖在页面上带内联 style
  item.isTop = Object.keys($(this).css()).length > 0
  list.push(item)
})
```

文件名日期取自 `new Date()`，runner 为 UTC 时区，格式 `${year}-${month}-${day}`（**月、日不补零**）。

### 4.3 汇总 `getNDayList(files, n)`

- `files`：`public/hot/` 下的日文件名（排除 `map.json / 3d / 7d / 30d / new.txt / test-*`），按日期倒序。
- 取最近 n 个日文件 → 按 `id` 去重（保留先出现的，即较新日期的那条）→ 按 `replyCount` 倒序。
- 过滤阈值：`7d` 仅保留 `replyCount > 50`；`30d` 仅保留 `replyCount > 100`；`3d` 不过滤。

## 5. 数据格式

`public/hot/YYYY-M-D.json`，数组，每项：

```json
{
  "id": 1241624,
  "title": "你们一天喝多少咖啡的？",
  "replyCount": 81,
  "avatar": "https://cdn.v2ex.com/avatar/...png",
  "username": "nathandoge",
  "lastReplyUsername": "LeBronJames1996",
  "lastReplyDateAgo": "21 mins ago",
  "lastReplyDate": "2026-09-14 01:55:15",
  "nodeTitle": "咖啡",
  "nodeUrl": "coffee",
  "isTop": false
}
```

其他文件：`3d.json` / `7d.json` / `30d.json`（同结构）、`map.json`（日期字符串数组）、`new.txt`（插件公告链接，与数据无关）。

## 6. 插件端读取（V2Next-script，仅供参考）

- 在「最热」tab 注入链接：`/v2hot?-1`（昨天）、`?-2`（前天）、`?3` / `?7` / `?30`、日历选某天 `?YYYY-M-D`。
- 映射为 `https://v2hotlist.vercel.app/hot/{YYYY-M-D | 3d | 7d | 30d}.json`，fetch 后删除原列表并按 V2EX 原生 DOM 结构重新渲染；失败提示「暂无点击日期的最热数据！」。

## 7. 已知问题 / 自己实现时要注意

1. **一天只有一个快照**：只反映抓取那一刻「最热」tab 的内容和回复数，不是全天统计。
2. **日期归属偏移**：cron 按 UTC 配置，GitHub Actions 定时经常延迟 2~3 小时；文件名取 UTC 日期。实测 `2026-9-1` ~ `2026-9-13` 每个文件的最晚回复时间都在**次日北京时间 01:26~03:03**，即 `D.json` ≈ 北京时间 D 日深夜到 D+1 凌晨的快照。
3. **存在缺失天**：截至 2026-09-13 共 674 个日文件（2024-10-15 起理论约 700 天），如 `2024-10-26` 缺失；脚本无补抓、无失败重试。
4. **依赖页面结构**：选择器 `div[class='cell item']`、`.topic-link`、`.count_livid`、`.topic_info` 一旦 V2EX 改版即失效，且会静默写出空数组。
5. **`isTop` 判断粗糙**：仅凭元素有无内联 style。
6. **第三方可用性**：`v2hotlist.vercel.app` 为作者个人部署，无稳定性保证；直接读 GitHub raw（`https://raw.githubusercontent.com/zyronon/V2Next-hot/hot/public/hot/<file>`）更稳。

改进方向（待探寻）：日期统一用北京时间、一天多次快照并按 id 合并取最大回复数、失败重试与空结果告警、选择器失效检测。

## 8. 本地已下载的数据

- 位置：`data/hot/`
- 范围：`2026-9-1.json` ~ `2026-9-13.json`，共 13 个文件，无缺失，均为合法 JSON（每天 32~40 条）
- 来源：`https://raw.githubusercontent.com/zyronon/V2Next-hot/hot/public/hot/`（`hot` 分支 `08886d6`）

补下载某天示例：

```bash
curl -o data/hot/2026-9-14.json https://raw.githubusercontent.com/zyronon/V2Next-hot/hot/public/hot/2026-9-14.json
```
