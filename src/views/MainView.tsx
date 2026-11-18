import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react'
import type { Idea, Priority, Snapshot, Task } from '../types'
import { dueLabel, stamp } from '../lib/time'
import { fileToBase64, imageFilesFromClipboard } from '../lib/clipboard'
import { AttachmentThumb, BrandMark, Icon, Keycap, PageHeading, PriorityChip } from '../components/ui'
import type { IconName } from '../components/ui'
import DetailPanel from './DetailPanel'
import LogsView from './LogsView'
import SettingsView from './SettingsView'

const NAV = [
  { key: 'inbox', label: '灵感', icon: 'star' },
  { key: 'tasks', label: '任务', icon: 'tasks' },
  { key: 'logs', label: '留痕', icon: 'journal' },
  { key: 'done', label: '已完成', icon: 'done' },
] as const

type View = (typeof NAV)[number]['key'] | 'settings'
type Row = { kind: 'idea'; idea: Idea } | { kind: 'task'; task: Task }
type Selection = { kind: Row['kind']; id: string }
type RowGroup = { label: string; items: Row[]; priority?: Priority }

const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']
const PRIORITY_RANK: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 4 }

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    const ra = a.priority ? PRIORITY_RANK[a.priority] : 0
    const rb = b.priority ? PRIORITY_RANK[b.priority] : 0
    if (ra !== rb) return rb - ra
    const da = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
    const db = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return (b.created_at || '').localeCompare(a.created_at || '')
  })
}

function rowItem(row: Row) { return row.kind === 'idea' ? row.idea : row.task }

function dayBucket(iso: string): string {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(d)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return '本周'
  return '更早'
}

function groupRows(rows: Row[], byPriority: boolean): RowGroup[] {
  const map = new Map<string, Row[]>()
  for (const row of rows) {
    const key = byPriority
      ? (row.kind === 'task' && row.task.priority) || 'none'
      : dayBucket(row.kind === 'idea' ? row.idea.created_at : row.task.done_at || row.task.created_at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  if (byPriority) {
    const groups = PRIORITY_ORDER.filter((key) => map.has(key)).map((priority) => ({ label: '优先级', items: map.get(priority)!, priority }))
    return map.has('none') ? [...groups, { label: '未设优先级', items: map.get('none')! }] : groups
  }
  return ['今天', '昨天', '本周', '更早'].filter((key) => map.has(key)).map((label) => ({ label, items: map.get(label)! }))
}

export default function Main() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [view, setView] = useState<View>('inbox')
  const [settingsReturn, setSettingsReturn] = useState<Exclude<View, 'settings'>>('inbox')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Selection | null>(null)
  const [splitId, setSplitId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('shining:sidebar') === '1')
  const [composer, setComposer] = useState('')
  const [composerImages, setComposerImages] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [toast, setToast] = useState('')
  const composerRef = useRef<HTMLInputElement>(null)
  const detailOpener = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const searching = !!query.trim()
  const canCompose = view === 'inbox' || view === 'tasks'
  const listView = view !== 'settings' && view !== 'logs'

  useEffect(() => { localStorage.setItem('shining:sidebar', collapsed ? '1' : '0') }, [collapsed])
  useEffect(() => {
    window.shining.snapshot().then(setSnap)
    return window.shining.onChanged(setSnap)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2300)
    return () => window.clearTimeout(timer)
  }, [toast])

  const counts = useMemo(() => ({
    inbox: snap?.ideas.filter((i) => i.status === 'inbox').length ?? 0,
    tasks: snap?.tasks.filter((t) => t.status !== 'done').length ?? 0,
    logs: snap?.logs?.length ?? 0,
    done: snap?.tasks.filter((t) => t.status === 'done').length ?? 0,
  }), [snap])

  const rows = useMemo<Row[]>(() => {
    if (!snap || !listView) return []
    const q = query.trim().toLowerCase()
    if (q) return [
      ...snap.ideas.filter((i) => i.status !== 'dropped' && i.content.toLowerCase().includes(q)).map((idea) => ({ kind: 'idea' as const, idea })),
      ...snap.tasks.filter((t) => t.content.toLowerCase().includes(q)).map((task) => ({ kind: 'task' as const, task })),
    ]
    if (view === 'inbox') return snap.ideas.filter((i) => i.status === 'inbox').map((idea) => ({ kind: 'idea', idea }))
    if (view === 'tasks') return sortTasks(snap.tasks.filter((t) => t.status !== 'done')).map((task) => ({ kind: 'task', task }))
    return snap.tasks.filter((t) => t.status === 'done')
      .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).map((task) => ({ kind: 'task', task }))
  }, [snap, view, listView, query])

  const selectedItem = useMemo(() => {
    if (!selected || !snap) return null
    const items = selected.kind === 'idea' ? snap.ideas : snap.tasks
    return items.find((i) => i.id === selected.id) || null
  }, [selected, snap])

  const byPriority = view === 'tasks' && !searching
  const grouped = useMemo(() => groupRows(rows, byPriority), [rows, byPriority])

  useEffect(() => {
    // 从新建框粘贴的图片会由表单消费；这里处理直接粘到已打开的记录上。
    const handler = async (e: ClipboardEvent) => {
      const files = imageFilesFromClipboard(e.clipboardData)
      if (!files.length || e.defaultPrevented || !listView) return
      if (!selectedItem || !selected) {
        setToast('请先选中一条记录，或在新建框中粘贴图片')
        return
      }
      e.preventDefault()
      try {
        const names: string[] = []
        for (const file of files) names.push(await window.shining.saveImage(await fileToBase64(file), file.type))
        const next = [...(selectedItem.images || []), ...names]
        if (selected.kind === 'idea') await window.shining.updateIdea(selectedItem.id, { images: next })
        else await window.shining.updateTask(selectedItem.id, { images: next })
      } catch {
        setToast('图片未能保存')
      }
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [selectedItem, selected, listView])

  function closeDetails() {
    setSelected(null)
    setSplitId(null)
    const opener = detailOpener.current
    detailOpener.current = null
    requestAnimationFrame(() => {
      if (opener?.getClientRects().length) opener.focus({ preventScroll: true })
      else (composerRef.current || searchRef.current)?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && canCompose) {
        e.preventDefault()
        setSelected(null)
        setSplitId(null)
        setQuery('')
        requestAnimationFrame(() => composerRef.current?.focus())
      }
      if (e.key === 'Escape' && selected && !e.defaultPrevented && !e.isComposing) {
        if (splitId) setSplitId(null)
        else closeDetails()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canCompose, selected, splitId])

  function navigate(next: View) {
    if (next === 'settings' && view !== 'settings') setSettingsReturn(view)
    setView(next)
    setQuery('')
    setSelected(null)
    setSplitId(null)
    detailOpener.current = null
    if (listRef.current) listRef.current.scrollTop = 0
  }

  async function submitComposer() {
    const text = composer.trim()
    if ((!text && !composerImages.length) || adding || pasting) return
    setAdding(true)
    try {
      if (view === 'tasks') await window.shining.createTask(text || '图片', undefined, composerImages)
      else await window.shining.createIdea(text || '图片', composerImages)
      setComposer('')
      setComposerImages([])
      listRef.current?.scrollTo({ top: 0 })
    } catch {
      setToast('没有保存，草稿已保留，请重试')
    } finally {
      setAdding(false)
      composerRef.current?.focus({ preventScroll: true })
    }
  }

  async function pasteToComposer(e: ReactClipboardEvent<HTMLInputElement>) {
    const files = imageFilesFromClipboard(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    if (pasting || adding) return
    setPasting(true)
    try {
      for (const file of files) {
        try {
          const name = await window.shining.saveImage(await fileToBase64(file), file.type)
          setComposerImages((prev) => [...prev, name])
        } catch {
          setToast('图片未能保存')
        }
      }
    } finally {
      setPasting(false)
    }
  }

  function select(row: Row, opener?: HTMLElement) {
    detailOpener.current = opener || null
    setSelected({ id: rowItem(row).id, kind: row.kind })
    setSplitId(null)
  }

  async function promote(idea: Idea) {
    const task = await window.shining.createTask(idea.content, idea.id)
    setSplitId(null)
    setSelected({ kind: 'task', id: task.id })
  }

  async function archive(idea: Idea) {
    await window.shining.updateIdea(idea.id, { status: 'archived' })
    if (selected?.id === idea.id) closeDetails()
  }

  async function removeIdea(idea: Idea) {
    await window.shining.deleteIdea(idea.id)
    if (selected?.id === idea.id) closeDetails()
  }

  async function toggleTask(task: Task, trigger?: HTMLElement) {
    await window.shining.updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })
    if (trigger && !trigger.isConnected && document.activeElement === document.body) {
      const next = listRef.current?.querySelector<HTMLElement>('.task-check')
      ;(next || composerRef.current || searchRef.current)?.focus({ preventScroll: true })
    }
  }

  async function removeTask(task: Task) {
    await window.shining.deleteTask(task.id)
    if (selected?.id === task.id) closeDetails()
  }

  if (!snap) return <div className="h-full bg-bg" />

  const listTitle = searching ? '搜索结果' : NAV.find((item) => item.key === view)?.label || ''
  const listDescription = searching ? `${rows.length} 条匹配 · 灵感与任务`
    : view === 'inbox' ? `${counts.inbox} 条待整理`
      : view === 'tasks' ? `${counts.tasks} 条待办 · 按优先级排列` : `${counts.done} 条已完成`
  const composerLabel = view === 'tasks' ? '新建任务' : '新建灵感'

  return (
    <div className="h-full flex bg-bg text-ink">
      <div role="status" className="pointer-events-none fixed bottom-5 inset-x-3 z-50 flex justify-center text-center">
        {toast && <span className="animate-fade rounded-[10px] bg-ink px-4 py-2 text-[13px] text-surface shadow-lg">{toast}</span>}
      </div>

      <aside className="sidebar" data-collapsed={collapsed} aria-label="侧栏">
        <div className="sidebar-brand drag">
          <BrandMark />
          <span className="sidebar-expanded sidebar-wordmark">闪灵</span>
        </div>
        <p className="sidebar-expanded sidebar-caption">工作台</p>
        <nav aria-label="工作台" className="space-y-1">
          {NAV.map((item) => (
            <button key={item.key} type="button" className="sidebar-item" aria-label={item.label} title={item.label} aria-current={view === item.key && !searching ? 'page' : undefined} onClick={() => navigate(item.key)}>
              <Icon name={item.icon} />
              <span className="sidebar-expanded">{item.label}</span>
              <span className="sidebar-expanded sidebar-count" aria-hidden="true">{counts[item.key]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-expanded sidebar-shortcuts">
            <div className="mb-2.5 flex items-center gap-2 font-semibold text-sub"><Icon name="keyboard" size={16} /> 快捷键</div>
            <div className="space-y-2.5 text-muted">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span>闪念</span><Keycap>{prettyKey(snap.settings.hotkey || 'Ctrl+Shift+Space')}</Keycap>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span>主窗</span><Keycap>{prettyKey(snap.settings.mainHotkey || 'Ctrl+Shift+X')}</Keycap>
              </div>
            </div>
          </div>
          <div className="sidebar-footer-row">
            <button type="button" className="sidebar-item" onClick={() => navigate('settings')} title="设置" aria-label="设置" aria-current={view === 'settings' ? 'page' : undefined}>
              <Icon name="settings" />
              <span className="sidebar-expanded">设置</span>
            </button>
            <button type="button" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} className="ui-icon-button sidebar-toggle">
              <Icon name="sidebar" />
            </button>
          </div>
        </div>
      </aside>

      <div className="workbench flex-1 min-w-0 flex flex-col">
        <header className="workspace-bar drag">
          {listView ? (
            <div className="workspace-search no-drag">
              <Icon name="search" size={17} />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(null)
                  setSplitId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query && !e.nativeEvent.isComposing) { e.preventDefault(); setQuery('') }
                }}
                placeholder="搜索灵感与任务"
                aria-label="搜索灵感与任务"
                className="ui-field"
              />
              {query && <button type="button" aria-label="清除搜索" title="清除搜索" className="ui-icon-button absolute right-0.5 top-1/2 -translate-y-1/2 size-7" onClick={() => { setQuery(''); searchRef.current?.focus() }}><Icon name="x" size={15} /></button>}
            </div>
          ) : <span aria-hidden="true" />}
          <div className="no-drag flex items-center gap-1">
            <WinButton action="min" label="最小化"><path d="M4 8h8" /></WinButton>
            <WinButton action="max" label="最大化"><rect x="4" y="4" width="8" height="8" rx="1" /></WinButton>
            <WinButton action="close" label="关闭"><path d="m4.5 4.5 7 7m0-7-7 7" /></WinButton>
          </div>
        </header>

        <div className="workbench-body">
          {view === 'settings' ? <SettingsView onClose={() => navigate(settingsReturn)} />
            : view === 'logs' ? <LogsView logs={snap.logs || []} />
              : (
                <main ref={listRef} className="page-scroll" aria-label={listTitle}>
                  <div className="page-content list-content">
                    <PageHeading title={listTitle} description={listDescription} compact>
                      {!searching && <DateStamp />}
                    </PageHeading>

                    {canCompose && !searching && (
                      <form className="entry-sheet mb-[18px]" onSubmit={(e) => { e.preventDefault(); void submitComposer() }}>
                        <div className="quick-entry-row">
                          <label htmlFor="quick-entry" className="quick-entry-label cursor-text text-[13px] font-semibold text-primary">
                            <span className="icon-tile"><Icon name={view === 'tasks' ? 'tasks' : 'star'} size={21} /></span>
                            {composerLabel}
                          </label>
                          <div className="quick-entry-box">
                            <input id="quick-entry" ref={composerRef}
                              aria-label={composerLabel}
                              value={composer}
                              onChange={(e) => setComposer(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                  e.preventDefault()
                                  void submitComposer()
                                }
                              }}
                              onPaste={pasteToComposer}
                              placeholder={view === 'tasks' ? '写下下一步…' : '写下一个念头…'}
                              className="ui-field"
                            />
                            <span className="quick-entry-key"><Keycap>Ctrl + N</Keycap></span>
                          </div>
                          <button type="submit" className="ui-button" data-tone="primary" disabled={adding || pasting || (!composer.trim() && !composerImages.length)}>
                            <Icon name="plus" size={15} className="hidden sm:block" /> {adding ? '保存中…' : '记下'}
                          </button>
                        </div>
                        {composerImages.length > 0 && (
                          <div className="flex flex-wrap gap-2 px-4 pb-3.5">
                            {composerImages.map((name) => (
                              <AttachmentThumb key={name} name={name} size="draft" disabled={adding} onRemove={() => {
                                setComposerImages((prev) => prev.filter((x) => x !== name))
                                void window.shining.deleteImage(name).catch(() => {})
                              }} />
                            ))}
                          </div>
                        )}
                      </form>
                    )}

                    {rows.length === 0 ? <EmptyState view={view} query={query.trim()} onCompose={canCompose && !searching ? () => composerRef.current?.focus() : undefined} /> : (
                      <div className="space-y-3.5">
                        {grouped.map((group) => (
                          <section key={group.priority || group.label} aria-label={group.priority ? undefined : group.label}>
                            <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-sub">
                              {group.priority && <PriorityChip priority={group.priority} />}
                              <span>{group.label}</span>
                              <span className="text-[12px] font-normal tabular-nums text-muted">{group.items.length} 条</span>
                            </h2>
                            <ul className="record-stack ui-surface">
                              {group.items.map((row) => {
                                const id = rowItem(row).id
                                return (
                                  <li key={row.kind + id}>
                                    <RowItem row={row} active={selected?.id === id && selected.kind === row.kind} showPriority={!byPriority}
                                      onSelect={(el) => select(row, el)}
                                      onSplit={(idea, el) => { select(row, el); setSplitId(idea.id) }}
                                      onPromote={promote} onArchive={archive} onRemoveIdea={removeIdea} onToggleTask={toggleTask} />
                                  </li>
                                )
                              })}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                </main>
              )}

          {selectedItem && selected && (
            <DetailPanel item={selectedItem} kind={selected.kind}
              onClose={closeDetails} splitOpen={splitId === selectedItem.id}
              onSplitOpen={() => setSplitId(selectedItem.id)} onSplitClose={() => setSplitId(null)}
              onPromote={promote} onArchive={archive} onToggleTask={toggleTask} onRemoveIdea={removeIdea} onRemoveTask={removeTask}
              onJumpToTask={(id) => setSelected({ kind: 'task', id })} />
          )}
        </div>
      </div>
    </div>
  )
}

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })

function DateStamp() {
  const date = new Date()
  return (
    <time className="page-date" dateTime={stamp(date.toISOString()).slice(0, 10)}>
      <Icon name="calendar" size={16} /> {dateFormat.format(date)} <span>周{'日一二三四五六'[date.getDay()]}</span>
    </time>
  )
}

function WinButton({ action, label, children }: { action: 'min' | 'max' | 'close'; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => window.shining.windowControl(action)} title={label} aria-label={label} className="ui-icon-button w-9" data-tone={action === 'close' ? 'window-close' : undefined}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">{children}</svg>
    </button>
  )
}

function RowItem({ row, active, showPriority, onSelect, onSplit, onPromote, onArchive, onRemoveIdea, onToggleTask }: {
  row: Row
  active: boolean
  showPriority: boolean
  onSelect: (element: HTMLElement) => void
  onSplit: (idea: Idea, element: HTMLElement) => void
  onPromote: (idea: Idea) => void
  onArchive: (idea: Idea) => void
  onRemoveIdea: (idea: Idea) => void
  onToggleTask: (task: Task, trigger: HTMLElement) => void
}) {
  const item = rowItem(row)
  const task = row.kind === 'task' ? row.task : null
  const idea = row.kind === 'idea' ? row.idea : null
  const done = task?.status === 'done'
  const time = item.created_at
  const hitRef = useRef<HTMLDivElement>(null)
  const taskToggleLabel = done ? '恢复为待办' : '标记完成'

  return (
    <div className="record-row" data-active={active}>
      {task && (
        <button type="button" onClick={(e) => onToggleTask(task, e.currentTarget)} className="task-check record-marker ui-icon-button" title={taskToggleLabel} aria-label={taskToggleLabel} aria-pressed={done}>
          <span className={`grid size-[18px] place-items-center rounded-[5px] border ${done ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-primary'}`}>
            {done && <Icon name="check" size={13} />}
          </span>
        </button>
      )}
      <div ref={hitRef} role="button" tabIndex={0}
        aria-label={`${idea ? '灵感' : '任务'}：${item.content}`} aria-pressed={active}
        onClick={(e) => onSelect(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(e.currentTarget) }
        }}
        className="record-hit"
      >
        {idea && <span className="record-marker pointer-events-none"><span className="grid size-7 place-items-center rounded-[8px] bg-idea-soft text-idea"><Icon name="idea" size={18} /></span></span>}
        <p className={`line-clamp-2 whitespace-pre-line wrap-anywhere text-[14px] leading-[1.55] font-medium ${done ? 'text-muted line-through' : 'text-ink'}`}>
          {item.content}
        </p>
        <div className="record-meta mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] leading-[1.4] text-muted">
          {task?.due_at && !done && <span className="inline-flex items-center gap-1 font-semibold text-sub"><Icon name="clock" size={13} />{dueLabel(task.due_at)}</span>}
          <time className="tabular-nums" dateTime={time}>{stamp(time)}</time>
          {showPriority && task?.priority && <PriorityChip priority={task.priority} />}
          {idea?.status === 'promoted' && <span className="rounded bg-primary-soft px-1.5 py-px text-primary">已成任务</span>}
          {!!item.images?.length && <span className="inline-flex items-center gap-1" aria-label={`${item.images.length} 张图片`}><Icon name="image" size={14} />{item.images.length}</span>}
        </div>
      </div>
      {idea?.status === 'inbox' && (
        <div className="record-actions" role="group" aria-label="灵感操作">
          <RowAction label="拆成待办" icon="split" onClick={() => { if (hitRef.current) onSplit(idea, hitRef.current) }} />
          <RowAction label="升格为任务" icon="promote" onClick={() => onPromote(idea)} />
          <RowAction label="沉淀" icon="archive" onClick={() => onArchive(idea)} />
          <RowAction label="删除" icon="trash" onClick={() => onRemoveIdea(idea)} danger />
        </div>
      )}
    </div>
  )
}

function RowAction({ label, icon, onClick, danger }: { label: string; icon: IconName; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="ui-icon-button row-action" data-tone={danger ? 'danger' : undefined}>
      <Icon name={icon} size={16} /><span aria-hidden="true" className="row-action-tip">{label}</span>
    </button>
  )
}

function prettyKey(key: string) { return key.replace(/Control/g, 'Ctrl').replace(/\s*\+\s*/g, ' + ') }

function EmptyState({ view, query, onCompose }: { view: View; query: string; onCompose?: () => void }) {
  const title = query ? '没有找到相关记录' : view === 'inbox' ? '还没有灵感' : view === 'tasks' ? '没有待办任务' : '还没有完成的任务'
  const description = query ? '换个关键词试试。' : view === 'inbox' ? '想到什么，就先记下来。' : view === 'tasks' ? '把下一步写在上面，或者从灵感升格。' : '标记完成的任务会出现在这里。'
  return (
    <div className="ui-surface grid min-h-60 place-items-center px-5 py-8 text-center">
      <div>
        <div className="relative mx-auto mb-4 grid size-[60px] place-items-center rounded-[20px] border border-line bg-bg text-primary">
          <Icon name={query ? 'search' : view === 'inbox' ? 'star' : view === 'tasks' ? 'tasks' : 'done'} size={29} />
        </div>
        <p className="text-[16px] font-semibold text-ink">{title}</p>
        <p className="mt-1.5 text-[13px] text-muted">{description}</p>
        {onCompose && <button type="button" className="ui-button mt-3" data-tone="accent" onClick={onCompose}>{view === 'tasks' ? '新建任务' : '新建灵感'}</button>}
      </div>
    </div>
  )
}
