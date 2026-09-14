# v2ex-hot

每天北京时间 22:00 由 GitHub Actions 抓取 V2EX「最热」tab，存到 `hot` 分支；本地脚本对照 Firefox 历史，生成当天未看帖子的 OneTab 导入文本。

实现参考 [V2Next-hot](https://github.com/zyronon/V2Next-hot)，调研记录见 [V2Next-hot实现记录.md](V2Next-hot实现记录.md)。

## 数据

- `hot` 分支，每天一个文件：`YYYY-M-D.json`（北京时间日期，月日不补零）
- 读取：`https://raw.githubusercontent.com/Renven/v2ex-hot/hot/2026-9-14.json`
- 2026-9-1 ~ 2026-9-13 的数据导入自 V2Next-hot（其抓取时间约为次日凌晨 2 点）

## 本地生成未看列表

需要 Node 22+。

```bash
node scripts/unread.js                      # 今天
node scripts/unread.js 3                    # 最近 3 天（含今天）
node scripts/unread.js 2026-9-10            # 某一天
node scripts/unread.js 2026-9-8 2026-9-10   # 日期区间
```

- 「看过」= Firefox 历史里访问过该帖子（任意时间）
- 多天时同一帖子只归到第一次上榜的那天，每天一组，用空行分隔
- 结果写入 `out/unread_<起>_<止>.txt` 并复制到剪贴板，到 OneTab →「Import / Export URLs」粘贴导入
- 默认使用历史库最近有写入的 Firefox 配置，可用环境变量 `FIREFOX_PROFILE` 指定目录
