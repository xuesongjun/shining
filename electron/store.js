const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const EMPTY = {
  version: 1,
  ideas: [],
  tasks: [],
  logs: [],
  settings: {
    hotkey: 'Control+Shift+Space',
    mainHotkey: 'Control+Shift+X',
    launchAtLogin: false,
    aiEnabled: true,
    autoSchedule: true,
  },
}

const now = () => new Date().toISOString()

function readTags(text) {
  const tags = []
  const re = /#([\p{L}\p{N}_-]+)/gu
  let m
  while ((m = re.exec(text))) tags.push(m[1])
  return [...new Set(tags)]
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'data.json')
    this.data = this.load()
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        ...EMPTY,
        ...parsed,
        ideas: parsed.ideas || [],
        // 老的 doing 状态没有入口可进，统一并回 todo
        tasks: (parsed.tasks || []).map((t) => ({
          priority: null,
          ...t,
          status: t.status === 'doing' ? 'todo' : t.status || 'todo',
        })),
        logs: parsed.logs || [],
        settings: { ...EMPTY.settings, ...(parsed.settings || {}) },
      }
    } catch {
      return structuredClone(EMPTY)
    }
  }

  persist() {
    const tmp = this.file + '.tmp'
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  commit() {
    this.persist()
    this.onChange && this.onChange()
  }

  snapshot() {
    return structuredClone(this.data)
  }

  createIdea(content, images = []) {
    const idea = {
      id: randomUUID(),
      content: content.trim(),
      status: 'inbox',
      tags: readTags(content),
      images: images || [],
      created_at: now(),
      updated_at: now(),
    }
    this.data.ideas.unshift(idea)
    this.commit()
    return idea
  }

  updateIdea(id, patch) {
    const idea = this.data.ideas.find((x) => x.id === id)
    if (!idea) return null
    Object.assign(idea, patch, { updated_at: now() })
    if (typeof patch.content === 'string') idea.tags = readTags(patch.content)
    this.commit()
    return idea
  }

  deleteIdea(id) {
    this.data.ideas = this.data.ideas.filter((x) => x.id !== id)
    this.commit()
  }

  createTask(content, ideaId, images = []) {
    const task = {
      id: randomUUID(),
      content: content.trim(),
      next_action: '',
      status: 'todo',
      tags: readTags(content),
      images: images || [],
      idea_id: ideaId || null,
      created_at: now(),
      done_at: null,
      due_at: null,
      remind: false,
      notified_at: null,
      priority: null,
    }
    this.data.tasks.unshift(task)
    if (ideaId) {
      const idea = this.data.ideas.find((x) => x.id === ideaId)
      if (idea) {
        idea.status = 'promoted'
        idea.task_id = task.id
        idea.updated_at = now()
      }
    }
    this.commit()
    return task
  }

  promoteIdeaToTasks(ideaId, contents) {
    const idea = this.data.ideas.find((x) => x.id === ideaId)
    const tasks = (contents || [])
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((content) => ({
        id: randomUUID(),
        content,
        next_action: '',
        status: 'todo',
        tags: readTags(content),
        idea_id: ideaId || null,
        created_at: now(),
        done_at: null,
        due_at: null,
        remind: false,
        notified_at: null,
        priority: null,
      }))

    if (!tasks.length) return []
    this.data.tasks.unshift(...tasks)
    if (idea) {
      idea.status = 'promoted'
      idea.task_id = null
      idea.updated_at = now()
    }
    this.commit()
    return tasks
  }

  updateTask(id, patch) {
    const task = this.data.tasks.find((x) => x.id === id)
    if (!task) return null
    Object.assign(task, patch)
    if (patch.status === 'done') task.done_at = now()
    if (patch.status && patch.status !== 'done') task.done_at = null
    if (typeof patch.content === 'string') task.tags = readTags(patch.content)
    // 截止时间被清空时，提醒也必须一起关掉
    if ('due_at' in patch && !patch.due_at) task.remind = false
    // 改了截止时间或重新打开提醒，就要重新武装通知
    if ('due_at' in patch || 'remind' in patch) task.notified_at = null
    this.commit()
    return task
  }

  /** AI 排期与定级结果落库；默认不覆盖用户手动设置的值 */
  applySchedule(updates, { force = false } = {}) {
    let changed = 0
    for (const u of updates || []) {
      const task = this.data.tasks.find((x) => x.id === u.id)
      if (!task) continue

      let touched = false
      if (u.due_at && (force || !task.due_at)) {
        task.due_at = u.due_at
        task.remind = !!u.remind
        task.notified_at = null
        touched = true
      }
      if (u.priority && (force || !task.priority)) {
        task.priority = u.priority
        touched = true
      }
      if (touched) changed++
    }
    if (changed) this.commit()
    return changed
  }

  markNotified(ids) {
    const stamp = now()
    let changed = false
    for (const id of ids) {
      const task = this.data.tasks.find((x) => x.id === id)
      if (task && !task.notified_at) {
        task.notified_at = stamp
        changed = true
      }
    }
    if (changed) this.commit()
  }

  /* ---------- 留痕 ---------- */

  addLog(content, images = []) {
    const log = {
      id: randomUUID(),
      content: String(content).trim(),
      images: images || [],
      created_at: now(),
    }
    this.data.logs = this.data.logs || []
    this.data.logs.unshift(log)
    this.commit()
    return log
  }

  deleteLog(id) {
    this.data.logs = (this.data.logs || []).filter((x) => x.id !== id)
    this.commit()
  }

  updateLog(id, patch) {
    const log = (this.data.logs || []).find((x) => x.id === id)
    if (!log) return null
    Object.assign(log, patch)
    this.commit()
    return log
  }

  updateLog(id, patch) {
    const log = (this.data.logs || []).find((x) => x.id === id)
    if (!log) return null
    Object.assign(log, patch)
    this.commit()
    return log
  }

  deleteTask(id) {
    const task = this.data.tasks.find((x) => x.id === id)
    if (task && task.idea_id) {
      const idea = this.data.ideas.find((x) => x.id === task.idea_id)
      if (idea && idea.task_id === id) {
        idea.status = 'inbox'
        idea.task_id = null
      }
    }
    this.data.tasks = this.data.tasks.filter((x) => x.id !== id)
    this.commit()
  }
}

module.exports = { Store }
