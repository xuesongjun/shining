/**
 * 拆待办：主进程内调用 OpenAI 兼容网关，失败时回落本地规则拆分。
 *
 * 已实测约束（见 AGENTS.md 第 7 节）：
 * - 必须带 chat_template_kwargs.thinking = false，否则延迟 3 倍、token 4 倍
 * - 不能用 response_format: json_object（会把多条压成一条）
 * - 超时 6s 即降级，规则兜底必须始终可用
 */

const TIMEOUT_MS = 6000

const SYSTEM_PROMPT = `你是任务拆解器。把用户的一段发散想法拆成可执行的待办。
规则：
1. 只输出 JSON 数组，不要任何解释，不要 markdown 代码块。
2. 按项目归组，每组形如 {"project":"原文里的项目名或产品名","tasks":["动词开头的动作描述"]}。
3. 原文点名项目或产品时，逐字复制名称到 project。同一项目贯穿的后续事项，即使没重复项目名，也归到该组；涉及多个项目分别建组。没有明确项目的事项归到 project 为 null 的组，不要猜。
4. 一件事一条，总共最多 8 条，不要重复。tasks 只写动作，不再添加项目名前缀；保留原文里的时间、对象、范围，不要编造新信息。
5. 不可执行的内容（感叹、偏好、疑问、吐槽）直接丢弃。

示例：输入「闪灵增加收藏搜索，再支持按关键词找回文章」，输出：
[{"project":"闪灵","tasks":["增加收藏搜索","支持按关键词找回收藏的文章"]}]`

function stripFence(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

// 只加原文里确实写到的名字，不把模型推测出来的名称变成任务标签。
function projectInSource(value, source) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name && name.length <= 48 && !/[\r\n【】]/.test(name) && typeof source === 'string' && source.includes(name) ? name : ''
}

function taskTitle(content, project) {
  if (!project) return content
  const prefix = `【${project}】`
  if (content.startsWith(prefix)) return content.slice(prefix.length).trim() ? content : ''
  for (const separator of ['：', ':', ' · ']) {
    const alternate = project + separator
    if (content.startsWith(alternate)) {
      const action = content.slice(alternate.length).trimStart()
      return action ? prefix + action : ''
    }
  }
  return prefix + content
}

function parseTasks(raw, source = '') {
  if (!raw) return []
  let text = stripFence(String(raw))
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out = []
  const addTask = (item, project) => {
    const content = typeof item === 'string' ? item : item?.content
    if (typeof content !== 'string') return
    const clean = content.trim().replace(/^[-•*\d.、\s]+/, '')
    if (clean.length < 2) return
    const title = taskTitle(clean, project)
    if (title && !out.includes(title)) out.push(title)
  }
  for (const item of parsed) {
    const project = projectInSource(item?.project, source)
    if (Array.isArray(item?.tasks)) {
      for (const task of item.tasks) {
        addTask(task, project)
        if (out.length === 8) return out
      }
    } else {
      // 兼容未按分组格式输出的模型。
      addTask(item, project)
      if (out.length === 8) return out
    }
  }
  return out
}

/**
 * 本地规则拆分：按标点与常见连接词切句，剥掉口语前缀。
 * 效果不如模型，但永远可用，且零延迟。
 */
function ruleSplit(text) {
  const cleaned = String(text)
    .replace(/[#＃][^\s，。；,;、]+/g, ' ')
    .trim()

  const out = []
  let project = ''
  for (const part of cleaned.split(/[，。；,;、\n]+|(?:\s*(?:还有|另外|顺便|然后|接着|同时|以及|并且|之后|最后)\s*)/)) {
    const heading = part.trim().match(/^项目\s*[：:]\s*(.+)$/)
    if (heading) {
      // 本地规则只识别明确的「项目：名称」标题，不从普通句子里猜项目。
      project = projectInSource(heading[1], cleaned)
      continue
    }
    const content = part.trim()
      .replace(/^(?:还要|要先|先|再|然后|另外|顺便|接着|同时|以及|并且|得|要|需要|记得|别忘了)\s*/, '')
      .replace(/^(?:给|把|将)\s*/, '')
      .trim()
    if (content.length < 3) continue
    const title = taskTitle(content, project)
    if (title && !out.includes(title)) out.push(title)
    if (out.length === 8) break
  }
  return out
}

async function chatCompletion({ baseUrl, apiKey, model, text, maxTokens = 900 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        chat_template_kwargs: { thinking: false },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`)
      err.status = res.status
      throw err
    }

    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timer)
  }
}

async function splitToTasks({ text, apiKey, baseUrl, model }) {
  const started = Date.now()

  if (!apiKey || !baseUrl || !model) {
    return {
      tasks: ruleSplit(text),
      source: 'rule',
      reason: apiKey ? 'no-service-config' : 'no-key',
      ms: Date.now() - started,
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chatCompletion({ baseUrl, apiKey, model, text })
      const tasks = parseTasks(raw, text)
      if (tasks.length) {
        return { tasks, source: 'llm', ms: Date.now() - started }
      }
    } catch (err) {
      // 401/400 重试没有意义，直接降级
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) break
    }
  }

  return {
    tasks: ruleSplit(text),
    source: 'rule',
    reason: 'fallback',
    ms: Date.now() - started,
  }
}

async function listModels({ apiKey, baseUrl }) {
  if (!apiKey) return { ok: false, reason: 'no-key', models: [] }
  if (!baseUrl) return { ok: false, reason: 'no-base-url', models: [] }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, models: [] }
    const data = await res.json()
    const models = (data?.data || []).map((m) => m.id).filter(Boolean)
    return { ok: true, models }
  } catch (err) {
    return { ok: false, reason: err.message, models: [] }
  } finally {
    clearTimeout(timer)
  }
}

async function health({ apiKey, baseUrl }) {
  if (!apiKey) return { ok: false, reason: 'no-key' }
  if (!baseUrl) return { ok: false, reason: 'no-base-url' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, reason: err.message }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- 时间解析 ---------- */

const SCHEDULE_PROMPT = `你是任务解析器。输入是 JSON 数组，每个元素是一条任务描述。
结合"当前时间"，判断每条任务的截止时间与优先级，输出同样长度的 JSON 数组。
每个元素形如：{"due_at":"YYYY-MM-DD HH:mm" 或 null,"remind": true 或 false,"priority":"low"|"medium"|"high"|"urgent" 或 null}
时间规则：
1. 只有出现明确或可推断的时间表达（今天/明天/后天/周五/下周一/11月20日/下午三点/两小时后/月底前）才给 due_at，否则必须是 null。
2. 只有时段没有钟点时：上午 10:00、中午 12:00、下午 15:00、傍晚 18:00、晚上 20:00。
3. 只有日期没有时段时，用 09:00。
4. remind：截止时间在 7 天内给 true，否则 false。
5. 不要根据"重要""尽快""有空"这类模糊词编造时间。
优先级规则：
6. urgent：今天之内必须完成，或时间很紧且误了后果严重（如马上要开的会、今天截止的交付）。
7. high：重要且有明确截止（会议、面试、对外承诺、有人等着要的东西）。
8. medium：普通待办，需要做但没有强时间压力。
9. low：杂事、有空再说、纯记录类。
10. 判断不了给 null，不要硬凑。
11. 只输出 JSON 数组，不要解释，不要 markdown 代码块。`

function localNowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const wd = '日一二三四五六'[d.getDay()]
  const fmt = (x) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
  const dow = (d.getDay() + 6) % 7 // 0 = 周一
  const mon = new Date(d)
  mon.setDate(d.getDate() - dow)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const nextMon = new Date(mon)
  nextMon.setDate(mon.getDate() + 7)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 周${wd}（本周一 ${fmt(mon)}，本周日 ${fmt(sun)}，下周一 ${fmt(nextMon)}）`
}

function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (!m) return null
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  )
  if (Number.isNaN(d.getTime())) return null
  // 明显跑偏的时间（超过一年）视为幻觉
  if (Math.abs(d.getTime() - Date.now()) > 366 * 24 * 3600 * 1000) return null
  return d.toISOString()
}

const PRIORITIES = new Set(['low', 'high', 'medium', 'urgent'])

function parseScheduleArray(raw, expected) {
  const text = stripFence(String(raw || ''))
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null

  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const out = []
  for (let i = 0; i < expected; i++) {
    const item = parsed[i]
    const due = item ? parseLocalDateTime(item.due_at) : null
    const priority = item && PRIORITIES.has(item.priority) ? item.priority : null
    out.push({ due_at: due, remind: !!(item && item.remind), priority })
  }
  return out
}

/**
 * 批量把任务描述解析成截止时间。一次请求覆盖多条，避免逐条串行调用。
 * 失败返回 null，调用方保持"不设置截止时间"的原状，绝不猜。
 */
async function parseSchedules({ texts, apiKey, baseUrl, model }) {
  if (!apiKey || !baseUrl || !model || !texts.length) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${SCHEDULE_PROMPT}\n当前时间：${localNowText()}` },
          { role: 'user', content: JSON.stringify(texts) },
        ],
        max_tokens: 600,
        temperature: 0,
        chat_template_kwargs: { thinking: false },
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    return parseScheduleArray(data?.choices?.[0]?.message?.content, texts.length)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- 周报 ---------- */

const REPORT_PROMPT = `你是工作周报助手。根据用户一段时间的工作留痕，整理成一份简洁的中文周报。
要求：
1. 按主题或项目归类，不要按时间流水账罗列。
2. 只写留痕里真实出现的内容，绝对不要编造。
3. 结构按：本周完成 / 正在推进 / 问题与风险 / 下周计划。没有内容的板块直接省略。
4. 每条一行，动词开头，尽量具体（做了什么、到什么程度）。
5. 全文不超过 400 字；不要使用 markdown 标题符号和代码块。`

async function generateReport({ entries, weekLabel, apiKey, baseUrl, model }) {
  if (!apiKey || !baseUrl || !model || !entries?.length) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: REPORT_PROMPT },
          {
            role: 'user',
            content: `周期：${weekLabel}\n\n工作留痕：\n${entries.map((e) => `- ${e}`).join('\n')}`,
          },
        ],
        max_tokens: 1200,
        temperature: 0.3,
        chat_template_kwargs: { thinking: false },
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    return typeof text === 'string' ? text.trim() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  splitToTasks,
  parseSchedules,
  generateReport,
  listModels,
  health,
  ruleSplit,
  parseTasks,
  parseScheduleArray,
}
