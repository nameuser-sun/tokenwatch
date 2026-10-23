// TokenWatch - DSH Token统计插件 v1.7.1 (纯JS版)
// 功能：状态栏计费 / 缓存命中率 / GitHub风格热力日历(持久化) / 一键预设(GLM/DeepSeek/Kimi/Claude/GPT) / 自定义模型自动分流

const cordis = globalThis.cordis || globalThis.Cordis || globalThis.__CORDIS__
if (!cordis || !cordis.Schema || !cordis.h) {
  throw new Error('[token-watch] 未找到宿主注入的 cordis，请确认在 DSH 环境下运行')
}

const { Schema, h } = cordis

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const name = 'token-watch'
export const Config = Schema.object({
  heavyModels: Schema.array(String)
    .description('高性能/高价模型组（复杂任务用，会被自动分流）')
    .default([]),
  lightModels: Schema.array(String)
    .description('经济型模型组（简单任务目标）')
    .default([]),
  priceHeavyInputMiss: Schema.number().default(0.014).description("高价组 未命中输入单价 / 百万token"),
  priceHeavyInputHit: Schema.number().default(0.0014).description("高价组 缓存命中输入单价 / 百万token"),
  priceHeavyOutput: Schema.number().default(0.014).description("高价组 输出单价 / 百万token"),
  priceLightInputMiss: Schema.number().default(0.007).description("经济组 未命中输入单价 / 百万token"),
  priceLightInputHit: Schema.number().default(0.0007).description("经济组 缓存命中输入单价 / 百万token"),
  priceLightOutput: Schema.number().default(0.007).description("经济组 输出单价 / 百万token"),
  enableAutoRoute: Schema.boolean().default(true).description("开启自动轻任务分流"),
  lightKeywords: Schema.array(String)
    .default(['教程','步骤','git','部署','解释','查一下','怎么配置','报错','命令'])
    .description("触发分流的关键词，小写匹配")
})

export function apply(ctx, cfg) {
  const dataDir = join(homedir(), '.token-watch')
const dataPath = join(dataDir, 'data.json')
  let persist = {
    dailyUsage: {},
    sessions: {}
  }

  async function loadData() {
    try {
      if (await fs.exists(dataPath)) {
        const raw = await fs.readFile(dataPath, 'utf8')
        persist = JSON.parse(raw)
      }
    } catch (e) {
      persist = { dailyUsage: {}, sessions: {} }
    }
  }
 async function saveData() {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(dataPath, JSON.stringify(persist, null, 2), 'utf8')
}
  const sessionMap = new Map()
  loadData().then(() => {
    for (const [sid, stat] of Object.entries(persist.sessions)) {
      sessionMap.set(sid, stat)
    }
  })

  // 五大主流模型价格预设（人民币/百万token）
  const presets = {
    glm: {
      heavyModels: ["glm-5.3-flashx"],
      lightModels: ["glm-5.3-flash"],
      priceHeavyInputMiss: 0.014,
      priceHeavyInputHit: 0.0014,
      priceHeavyOutput: 0.014,
      priceLightInputMiss: 0.007,
      priceLightInputHit: 0.0007,
      priceLightOutput: 0.007
    },
    deepseek: {
      heavyModels: ["deepseek-v3"],
      lightModels: ["deepseek-chat"],
      priceHeavyInputMiss: 0.14,
      priceHeavyInputHit: 0.014,
      priceHeavyOutput: 0.28,
      priceLightInputMiss: 0.07,
      priceLightInputHit: 0.007,
      priceLightOutput: 0.14
    },
    kimi: {
      heavyModels: ["kimi-k2.6"],
      lightModels: ["kimi-k2.5"],
      priceHeavyInputMiss: 0.02,
      priceHeavyInputHit: 0.002,
      priceHeavyOutput: 0.08,
      priceLightInputMiss: 0.01,
      priceLightInputHit: 0.001,
      priceLightOutput: 0.04
    },
    claude: {
      heavyModels: ["claude-3-5-sonnet"],
      lightModels: ["claude-3-haiku"],
      priceHeavyInputMiss: 21.6,
      priceHeavyInputHit: 2.16,
      priceHeavyOutput: 108,
      priceLightInputMiss: 5.76,
      priceLightInputHit: 0.576,
      priceLightOutput: 28.8
    },
    gpt: {
      heavyModels: ["gpt-4o"],
      lightModels: ["gpt-4o-mini"],
      priceHeavyInputMiss: 18,
      priceHeavyInputHit: 2.16,
      priceHeavyOutput: 72,
      priceLightInputMiss: 1.08,
      priceLightInputHit: 0.216,
      priceLightOutput: 4.32
    }
  }

  function applyPreset(key) {
    const p = presets[key]
    cfg.heavyModels = [...p.heavyModels]
    cfg.lightModels = [...p.lightModels]
    cfg.priceHeavyInputMiss = p.priceHeavyInputMiss
    cfg.priceHeavyInputHit = p.priceHeavyInputHit
    cfg.priceHeavyOutput = p.priceHeavyOutput
    cfg.priceLightInputMiss = p.priceLightInputMiss
    cfg.priceLightInputHit = p.priceLightInputHit
    cfg.priceLightOutput = p.priceLightOutput
    const nameMap = {
      glm: "智谱GLM5.3",
      deepseek: "DeepSeek",
      kimi: "Kimi月之暗面",
      claude: "Claude克劳德",
      gpt: "OpenAI GPT"
    }
    ctx.notification.success(`✅ 已加载预设：${nameMap[key]}`)
  }

  async function resetAllData() {
    persist = { dailyUsage: {}, sessions: {} }
    sessionMap.clear()
    await saveData()
    ctx.notification.success("🗑️ 全部统计数据已清空")
  }

  const getColor = (val, maxVal) => {
    if (val <= 0) return '#f1f1f1'
    const ratio = val / maxVal
    const palette = ['#e6f0f8','#b9d7f0','#78aed8','#3b7fb8','#1a4e82']
    const idx = Math.min(Math.floor(ratio * palette.length), palette.length - 1)
    return palette[idx]
  }

  function buildCalendarGrid(weeks = 22) {
    const grid = []
    let day = new Date()
    day.setDate(day.getDate() - day.getDay())
    const values = Object.values(persist.dailyUsage)
    const maxVal = values.length ? Math.max(...values) : 1
    for (let w = 0; w < weeks; w++) {
      const weekCol = []
      for (let d = 0; d < 7; d++) {
        const dateStr = day.toISOString().slice(0, 10)
        weekCol.push({ date: dateStr, val: persist.dailyUsage[dateStr] ?? 0 })
        day.setDate(day.getDate() + 1)
      }
      grid.push(weekCol)
    }
    return { grid, maxVal }
  }

  function getPriceCfg(modelId) {
    const isHeavy = cfg.heavyModels.some(m => modelId.includes(m))
    if (isHeavy) {
      return {
        inMiss: cfg.priceHeavyInputMiss,
        inHit: cfg.priceHeavyInputHit,
        out: cfg.priceHeavyOutput
      }
    } else {
      return {
        inMiss: cfg.priceLightInputMiss,
        inHit: cfg.priceLightInputHit,
        out: cfg.priceLightOutput
      }
    }
  }

  ctx.ui.statusBar.register({
    id: 'token-watch',
    render() {
      const sid = ctx.session.activeId
      const s = sessionMap.get(sid)
      if (!s) return h('span', '📊 TokenWatch')
      const totalInput = s.hit + s.miss
      const hitRate = totalInput ? (s.hit / totalInput * 100).toFixed(1) : '0'
      const priceSet = getPriceCfg(ctx.session.model || '')
      const cost = (
        s.miss * priceSet.inMiss +
        s.hit * priceSet.inHit +
        s.output * priceSet.out
      ) / 1_000_000
      return h('span', { onClick: () => ctx.ui.modal.open('token-panel') },
        `💸 ${cost.toFixed(3)}元 | 缓存${hitRate}% | out:${s.output}`
      )
    }
  })

  ctx.ui.panel.register({
    id: 'token-panel',
    title: 'Token用量 & 热力日历',
    render() {
      const sid = ctx.session.activeId
      const s = sessionMap.get(sid)
      const { grid, maxVal } = buildCalendarGrid()

      const domList = []
      domList.push(h('div', { style: 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap' },
        h('button', { onclick: () => applyPreset('glm') }, 'GLM'),
        h('button', { onclick: () => applyPreset('deepseek') }, 'DeepSeek'),
        h('button', { onclick: () => applyPreset('kimi') }, 'Kimi'),
        h('button', { onclick: () => applyPreset('claude') }, 'Claude'),
        h('button', { onclick: () => applyPreset('gpt') }, 'GPT'),
        h('button', { onclick: resetAllData, style: 'color:#ff4444' }, '重置数据')
      ))

      if (s) {
        const totalInput = s.hit + s.miss
        const hitRate = totalInput ? (s.hit / totalInput * 100).toFixed(2) : '0'
        const priceSet = getPriceCfg(ctx.session.model || '')
        const cost = (
          s.miss * priceSet.inMiss +
          s.hit * priceSet.inHit +
          s.output * priceSet.out
        ) / 1_000_000
        domList.push(h('div', [
          h('p', `会话累计：命中 ${s.hit} | 未命中 ${s.miss} | 输出 ${s.output}`),
          h('p', `缓存命中率：${hitRate}%`),
          h('p', `预估费用：${cost.toFixed(4)} 元`),
          h('p', `当前会话模型：${ctx.session.model || '未选定'}`),
          h('hr'),
          h('p', '分流规则设置：'),
          h('li', `高价组：${cfg.heavyModels.join('、') || '未配置'}`),
          h('li', `经济组：${cfg.lightModels.join('、') || '未配置'}`),
        ]))
      } else {
        domList.push(h('p', '暂无会话数据'))
      }

      const calendarDom = h('div', { style: 'display:flex;gap:3px;margin-top:12px;flex-direction:column' },
        grid.map(week =>
          h('div', { style: 'display:flex;gap:3px' },
            week.map(cell =>
              h('div', {
                style: {
                  width: '12px',
                  height: '12px',
                  borderRadius: '2px',
                  backgroundColor: getColor(cell.val, maxVal)
                },
                title: `${cell.date}: ${cell.val.toLocaleString()} token`
              })
            )
          )
        )
      )
      domList.push(h('div', [
        h('p', '📅 每日总消耗热力图（颜色越深消耗越高）'),
        calendarDom
      ]))
      return h('div', domList)
    }
  })

  ctx.on('model.response', async (resp, req) => {
    const sid = req.sessionId
    if (!sessionMap.has(sid)) {
      const empty = { hit:0, miss:0, output:0 }
      sessionMap.set(sid, empty)
    }
    const s = sessionMap.get(sid)
    const u = resp.usage
    const hit = u.prompt_cache_hit_tokens ?? 0
    const miss = u.prompt_cache_miss_tokens ?? 0
    const out = u.completion_tokens ?? 0
    s.hit += hit
    s.miss += miss
    s.output += out
    persist.sessions[sid] = s

    const today = new Date().toISOString().slice(0, 10)
    persist.dailyUsage[today] = (persist.dailyUsage[today] ?? 0) + hit + miss + out
    await saveData()

    if (!cfg.enableAutoRoute) return
    const currentModel = req.model
    if (!cfg.heavyModels.some(m => currentModel.includes(m))) return
    if (cfg.lightModels.length === 0) return

    const promptText = req.messages.map(m => m.content).join('\n').toLowerCase()
    const trigger = cfg.lightKeywords.some(k => promptText.includes(k.toLowerCase()))
    if (trigger) {
      const targetModel = cfg.lightModels[0]
      ctx.notification.warn(`⚠️ 轻任务识别，自动切换模型：${targetModel}`)
      req.model = targetModel
    }
  })

  ctx.on('session/switch', (sid) => {
    if (!sessionMap.has(sid)) {
      const empty = { hit:0, miss:0, output:0 }
      sessionMap.set(sid, empty)
      persist.sessions[sid] = empty
    }
  })
}
