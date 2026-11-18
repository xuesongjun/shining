import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry } from '../types'
import { AttachmentThumb, Icon, Keycap, PageHeading } from '../components/ui'
import { stamp } from '../lib/time'

const pad = (n: number) => String(n).padStart(2, '0')

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function mondayOf(d: Date) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function md(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function dayLabel(d: Date) {
  const today = startOfDay(new Date()).getTime()
  const days = Math.round((today - startOfDay(d).getTime()) / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  return `${md(d)} 周${'日一二三四五六'[d.getDay()]}`
}

type DayGroup = { key: string; label: string; items: LogEntry[] }
type WeekGroup = {
  key: string
  label: string
  range: string
  items: LogEntry[]
  days: DayGroup[]
}

function buildWeeks(logs: LogEntry[]): WeekGroup[] {
  const weekMap = new Map<string, LogEntry[]>()
  for (const log of logs) {
    const key = ymd(mondayOf(new Date(log.created_at)))
    if (!weekMap.has(key)) weekMap.set(key, [])
    weekMap.get(key)!.push(log)
  }

  const thisMonday = ymd(mondayOf(new Date()))
  return [...weekMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const mon = new Date(`${key}T00:00:00`)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)

      const weeksAgo = Math.round(
        (new Date(`${thisMonday}T00:00:00`).getTime() - mon.getTime()) / (7 * 86400000),
      )
      const label = weeksAgo <= 0 ? '本周' : weeksAgo === 1 ? '上周' : `${weeksAgo} 周前`

      const dayMap = new Map<string, LogEntry[]>()
      for (const item of items) {
        const dk = ymd(new Date(item.created_at))
        if (!dayMap.has(dk)) dayMap.set(dk, [])
        dayMap.get(dk)!.push(item)
      }
      const days = [...dayMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([dk, list]) => ({ key: dk, label: dayLabel(new Date(`${dk}T00:00:00`)), items: list }))

      return { key, label, range: `${md(mon)} - ${md(sun)}`, items, days }
    })
}

export default function LogsView({ logs }: { logs: LogEntry[] }) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [manualCollapse, setManualCollapse] = useState<Record<string, boolean>>({})
  const [report, setReport] = useState<{ text: string; label: string } | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  const weeks = useMemo(() => buildWeeks(logs), [logs])
  useEffect(() => {
    if (report && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [report])

  async function save() {
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setSaveError('')
    try {
      await window.shining.createLog(text)
      setDraft('')
    } catch {
      setSaveError('没有保存，草稿已保留，请重试。')
    } finally {
      setSaving(false)
    }
  }

  function isCollapsed(key: string, index: number) {
    return manualCollapse[key] ?? index > 0
  }

  function toggle(key: string, index: number) {
    setManualCollapse((prev) => ({ ...prev, [key]: !isCollapsed(key, index) }))
  }

  async function removeLogImage(entry: LogEntry, name: string) {
    try {
      const next = (entry.images || []).filter((x) => x !== name)
      await window.shining.updateLog(entry.id, { images: next })
      await window.shining.deleteImage(name)
    } catch {
      setError('未能删除图片，请重试。')
    }
  }

  async function makeReport(week: WeekGroup) {
    if (generating) return
    setGenerating(week.key)
    setError('')
    try {
      const text = await window.shining.generateReport(
        week.range,
        week.items.map((i) => i.content),
      )
      if (text) setReport({ text, label: week.range })
      else setError('生成失败：网关没有返回内容')
    } catch {
      setError('生成失败，请稍后重试')
    } finally {
      setGenerating(null)
    }
  }

  async function copyReport() {
    if (!report) return
    setCopyError('')
    try {
      await navigator.clipboard.writeText(report.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyError('无法复制，请手动选中周报文本。')
    }
  }

  return (
    <main className="page-scroll" aria-label="留痕">
      <div className="page-content">
        <PageHeading title="留痕" description={`${logs.length} 条工作记录 · 按周整理`} />
        <form className="entry-sheet mb-6 px-4 py-3.5 sm:px-5" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <label htmlFor="log-entry" className="flex w-fit items-center gap-2 text-[13px] font-semibold text-primary">
            <Icon name="journal" size={17} /> 新建留痕
          </label>
          <textarea id="log-entry" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void save() }
            }}
            rows={2} placeholder="今天推进了哪件事？" aria-label="记录工作留痕"
            className="ui-field mt-2 min-h-16 max-h-48 w-full resize-none leading-6" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Keycap>Ctrl + Enter</Keycap>
            <button type="submit" disabled={!draft.trim() || saving} className="ui-button ml-auto" data-tone="primary">
              <Icon name="plus" size={16} /> {saving ? '保存中…' : '记一笔'}
            </button>
          </div>
          <p role="status" className="mt-2 text-[12px] text-danger empty:hidden">{saveError}</p>
        </form>

        {!weeks.length ? (
          <div className="ui-surface grid min-h-48 place-items-center px-5 py-8 text-center">
            <div>
              <span className="icon-tile mx-auto mb-3"><Icon name="journal" size={20} /></span>
              <p className="text-[16px] font-semibold text-ink">还没有留痕</p>
              <p className="mt-1 text-[13px] text-muted">记录今天做过的事，之后可以生成周报。</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {weeks.map((week, index) => {
              const collapsed = isCollapsed(week.key, index)
              return (
                <section key={week.key} className="ui-surface">
                  <div className="flex min-h-14 flex-wrap items-center gap-2 p-2.5 sm:px-4">
                    <button type="button" onClick={() => toggle(week.key, index)} aria-expanded={!collapsed} aria-controls={`week-${week.key}`}
                      className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-bg">
                      <Icon name="chevron" size={16} className="week-chevron shrink-0 text-primary" />
                      <span className="text-[14px] font-semibold">{week.label}</span>
                      <span className="text-[12px] text-muted tabular-nums">{week.range} · {week.items.length} 条</span>
                    </button>
                    <button type="button" onClick={() => makeReport(week)} disabled={!!generating} className="ui-button ml-auto min-h-8" data-tone="accent">
                      <Icon name="star" size={16} /> {generating === week.key ? '生成中…' : '生成周报'}
                    </button>
                  </div>

                  <div id={`week-${week.key}`} hidden={collapsed} className="border-t border-line px-4 py-4 sm:px-5">
                    {!collapsed && (
                      <div className="animate-fade space-y-3.5 border-l border-line pl-4">
                        {week.days.map((day) => (
                          <section key={day.key}>
                            <h3 className="relative mb-1 text-[13px] font-semibold text-primary">
                              <span className="absolute top-1/2 -left-[20px] size-[7px] -translate-y-1/2 rounded-full bg-primary ring-[3px] ring-surface" aria-hidden="true" />
                              {day.label}
                            </h3>
                            <ul>
                              {day.items.map((item) => (
                                <li key={item.id} className="group flex min-h-9 flex-wrap items-start gap-x-3 gap-y-0 rounded-[8px] py-1 transition-colors hover:bg-bg">
                                  <time dateTime={item.created_at} className="shrink-0 text-[12px] leading-6 tabular-nums text-muted">{stamp(item.created_at)}</time>
                                  <div className="min-w-[170px] flex-1">
                                    <p className="whitespace-pre-wrap wrap-anywhere text-[14px] leading-6 text-ink">{item.content}</p>
                                    {!!item.images?.length && (
                                      <div className="mt-2 mb-1 flex flex-wrap gap-2">
                                        {item.images.map((name) => (
                                          <AttachmentThumb key={name} name={name} size="detail" onOpen={() => window.shining.openImage(name)} onRemove={() => removeLogImage(item, name)} removeLabel="删除这张图" />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <button type="button" onClick={() => window.shining.deleteLog(item.id)} title="删除这条留痕" aria-label="删除这条留痕"
                                    className="ui-icon-button ml-auto size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" data-tone="danger">
                                    <Icon name="trash" size={15} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
        <p role="status" className="mt-3 text-[13px] text-danger empty:hidden">{error}</p>
      </div>

      {report && (
        <dialog ref={dialogRef} className="report-dialog ui-surface" aria-labelledby="report-title"
          onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}
          onClose={() => { setReport(null); setCopied(false); setCopyError('') }}>
          <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
            <span className="icon-tile size-8 rounded-[8px]"><Icon name="journal" size={18} /></span>
            <h2 id="report-title" className="text-[16px] font-semibold">工作周报</h2>
            <span className="text-[12px] text-muted">{report.label}</span>
            <button type="button" onClick={copyReport} className="ui-button ml-auto" data-tone="outline"><Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? '已复制' : '复制'}</button>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭周报" title="关闭周报" className="ui-icon-button"><Icon name="x" size={17} /></button>
          </header>
          <pre className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-sans text-[14px] leading-6 whitespace-pre-wrap wrap-anywhere text-ink">{report.text}</pre>
          <div role="status" className="sr-only">{copied ? '已复制周报' : ''}</div>
          {copyError && <p role="alert" className="border-t border-line px-5 py-2 text-[13px] text-danger">{copyError}</p>}
        </dialog>
      )}
    </main>
  )
}
