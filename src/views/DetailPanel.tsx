import { useEffect, useRef, useState } from 'react'
import type { Idea, Priority, Task } from '../types'
import { fromLocalInput, stamp, toLocalInput } from '../lib/time'
import { AttachmentThumb, Icon, PRIORITY_LABEL } from '../components/ui'
import SplitPanel from './SplitPanel'

type Props = {
  item: Idea | Task
  kind: 'idea' | 'task'
  onClose: () => void
  splitOpen: boolean
  onSplitOpen: () => void
  onSplitClose: () => void
  onPromote: (idea: Idea) => void
  onArchive: (idea: Idea) => void
  onToggleTask: (task: Task) => void
  onRemoveIdea: (idea: Idea) => void
  onRemoveTask: (task: Task) => void
  onJumpToTask: (id: string) => void
}

const priorities: Priority[] = ['low', 'medium', 'high', 'urgent']

export default function DetailPanel({ item, kind, onClose, splitOpen, onSplitOpen, onSplitClose, onPromote, onArchive, onToggleTask, onRemoveIdea, onRemoveTask, onJumpToTask }: Props) {
  const [draft, setDraft] = useState(item.content)
  const [parsing, setParsing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLElement>(null)
  const idea = kind === 'idea' ? item as Idea : null
  const task = kind === 'task' ? item as Task : null
  const images = item.images || []
  const title = idea ? '灵感详情' : '任务详情'

  useEffect(() => setDraft(item.content), [item.content, item.id])
  useEffect(() => {
    setEditing(false)
    setError('')
  }, [item.id])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-detail-focus]')?.focus({ preventScroll: true })
  }, [item.id, splitOpen])

  async function save() {
    setEditing(false)
    const content = draft.trim()
    if (!content) { setDraft(item.content); return }
    if (content === item.content) return
    setError('')
    try {
      if (idea) await window.shining.updateIdea(item.id, { content })
      else await window.shining.updateTask(item.id, { content })
    } catch {
      setError('未能保存修改，原记录已保留。')
    }
  }

  async function addImages() {
    setError('')
    try {
      const names = await window.shining.pickImages()
      if (!names.length) return
      const next = [...images, ...names]
      if (idea) await window.shining.updateIdea(item.id, { images: next })
      else await window.shining.updateTask(item.id, { images: next })
    } catch {
      setError('无法添加图片，请重试。')
    }
  }

  async function removeImage(name: string) {
    setError('')
    try {
      const next = images.filter((x) => x !== name)
      if (idea) await window.shining.updateIdea(item.id, { images: next })
      else await window.shining.updateTask(item.id, { images: next })
      await window.shining.deleteImage(name)
    } catch {
      setError('未能删除图片，请重试。')
    }
  }

  async function schedule() {
    if (!task || parsing) return
    setParsing(true)
    setError('')
    try {
      await window.shining.scheduleTask(task.id)
    } catch {
      setError('AI 排期失败，请稍后重试。')
    } finally {
      setParsing(false)
    }
  }

  return (
    <aside ref={ref} className="detail-panel no-drag" aria-label={splitOpen ? '拆成待办' : title}>
      {splitOpen && idea ? <SplitPanel key={idea.id} idea={idea} onClose={onSplitClose} /> : (
        <>
          <div className="detail-head">
            <span className="icon-tile size-8 rounded-[8px]" data-idea={!!idea}>
              <Icon name={idea ? 'idea' : 'tasks'} className={idea ? 'text-idea' : undefined} />
            </span>
            <span>{title}</span>
            {task?.status === 'done' && <span className="rounded bg-primary-soft px-1.5 py-1 text-[12px] text-primary">已完成</span>}
            {task?.status === 'shelved' && <span className="rounded bg-bg px-1.5 py-1 text-[12px] text-muted">搁置</span>}
            <button type="button" data-detail-focus onClick={onClose} aria-label="关闭详情" title="关闭详情" className="ui-icon-button ml-auto w-auto min-w-8 px-1.5">
              <Icon name="x" size={18} /><span className="detail-close-text text-[12px] font-normal">返回列表</span>
            </button>
          </div>

          <div className="detail-body min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {editing ? (
              <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) e.currentTarget.blur()
                }}
                rows={3} aria-label="编辑内容" className="ui-field max-h-56 w-full resize-none text-[17px] leading-[1.6]" />
            ) : (
              <h2 className="font-semibold">
                <button type="button" onClick={() => setEditing(true)} title="编辑内容" className="flex w-full items-start gap-3 rounded-[6px] text-left text-[18px] leading-[1.55] text-ink hover:text-primary">
                  <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">{item.content}</span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-bg text-muted"><Icon name="edit" size={15} /></span>
                </button>
              </h2>
            )}

            <div className="mt-5 space-y-3.5 border-t border-line pt-4 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-muted">{idea ? '记录时间' : '创建时间'}</span>
                <time dateTime={item.created_at} className="tabular-nums text-sub">{stamp(item.created_at)}</time>
              </div>

              {task && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <span className="font-medium text-sub">优先级</span>
                    <div role="group" aria-label="优先级" className="flex flex-wrap gap-1.5">
                      {priorities.map((p) => {
                        const active = task.priority === p
                        return (
                          <button key={p} type="button" onClick={() => window.shining.updateTask(task.id, { priority: active ? null : p })}
                            aria-pressed={active} aria-label={`优先级：${PRIORITY_LABEL[p]}`} title={`优先级：${PRIORITY_LABEL[p]}`}
                            data-priority={p} className="priority-picker transition-colors hover:border-primary">
                            {PRIORITY_LABEL[p]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="task-due" className="font-medium text-sub">截止时间</label>
                      <button type="button" onClick={schedule} disabled={parsing} aria-label="用 AI 识别时间" title="用 AI 重新识别时间和优先级" className="ui-button min-h-7 px-2 py-1 text-[12px]" data-tone="accent">
                        <Icon name="star" size={14} /> {parsing ? '识别中…' : 'AI 排期'}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input id="task-due" type="datetime-local" value={task.due_at ? toLocalInput(task.due_at) : ''}
                        onChange={(e) => window.shining.updateTask(task.id, { due_at: fromLocalInput(e.target.value) })}
                        className="ui-field w-full tabular-nums" />
                      {task.due_at && (
                        <button type="button" onClick={() => window.shining.updateTask(task.id, { due_at: null })} aria-label="清除截止时间" title="清除截止时间" className="ui-icon-button"><Icon name="x" size={16} /></button>
                      )}
                    </div>
                  </div>
                  <label className="flex min-h-7 items-center justify-between gap-3">
                    <span className="text-muted">提醒</span>
                    <span className="flex items-center gap-2 text-sub">
                      <input type="checkbox" checked={!!task.remind} disabled={!task.due_at}
                        onChange={(e) => window.shining.updateTask(task.id, { remind: e.target.checked })}
                        aria-label="到点提醒" className="size-4 accent-primary disabled:opacity-50" />
                      {task.due_at ? '到点通知' : '先设截止时间'}
                    </span>
                  </label>
                </>
              )}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-muted">
                  <span>标签</span>
                  <span className="wrap-anywhere text-sub">{item.tags.map((t) => `#${t}`).join(' ')}</span>
                </div>
              )}
              {idea?.status === 'promoted' && idea.task_id && (
                <button type="button" onClick={() => onJumpToTask(idea.task_id!)} className="ui-button" data-tone="accent">查看关联任务 <Icon name="chevron" size={15} /></button>
              )}
            </div>

            <section aria-label="附件" className="mt-5 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-sub">
                  图片 <span className="text-[12px] font-normal tabular-nums text-muted">{images.length} 张</span>
                </h3>
                <button type="button" onClick={addImages} className="ui-button min-h-8 text-[12px]" data-tone="outline"><Icon name="plus" size={15} /> 图片</button>
              </div>
              {images.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {images.map((name) => (
                    <AttachmentThumb key={name} name={name} size="detail" onOpen={() => window.shining.openImage(name)} onRemove={() => removeImage(name)} removeLabel="删除这张图" />
                  ))}
                </div>
              ) : <p className="mt-2 text-[12px] text-muted">可粘贴截图，或从本机选择图片。</p>}
              <p role="status" className="mt-2 text-[12px] text-danger empty:hidden">{error}</p>
            </section>
          </div>

          <div className="detail-foot">
            {idea ? (
              <>
                {idea.status === 'inbox' && (
                  <div className="mb-1.5 flex flex-wrap gap-2">
                    <button type="button" className="ui-button" data-tone="primary" onClick={onSplitOpen}><Icon name="split" size={16} /> 拆成待办</button>
                    <button type="button" className="ui-button" data-tone="outline" onClick={() => onPromote(idea)}><Icon name="promote" size={16} /> 升格为任务</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {idea.status === 'inbox' && <button type="button" className="ui-button min-h-8" onClick={() => onArchive(idea)}><Icon name="archive" size={16} /> 沉淀</button>}
                  <button type="button" className="ui-button ml-auto min-h-8" data-tone="danger" onClick={() => onRemoveIdea(idea)}><Icon name="trash" size={16} /> 删除</button>
                </div>
              </>
            ) : task && (
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" className="ui-button" data-tone="primary" onClick={() => onToggleTask(task)}>
                  <Icon name={task.status === 'done' ? 'refresh' : 'check'} size={16} /> {task.status === 'done' ? '恢复为待办' : '标记完成'}
                </button>
                <button type="button" className="ui-button ml-auto" data-tone="danger" onClick={() => onRemoveTask(task)}><Icon name="trash" size={16} /> 删除</button>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
