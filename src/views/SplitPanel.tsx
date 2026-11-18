import { useEffect, useState } from 'react'
import type { Idea } from '../types'
import { Icon } from '../components/ui'

type Draft = { content: string; checked: boolean }

export default function SplitPanel({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [source, setSource] = useState<'llm' | 'rule' | null>(null)
  const [ms, setMs] = useState(0)
  const [note, setNote] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    split()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function split() {
    setLoading(true)
    setNote('')
    setNeedKey(false)
    try {
      const status = await window.shining.aiStatus()
      if (!status.configured) {
        setNeedKey(true)
        setDrafts([])
        return
      }
      const res = await window.shining.splitIdea(idea.content)
      setDrafts(res.tasks.map((content) => ({ content, checked: true })))
      setSource(res.source)
      setMs(res.ms || 0)
      if (res.source === 'rule') {
        setNote(res.reason === 'no-key' ? '未配置 Key，使用本地规则拆分'
          : res.reason === 'no-service-config' ? '未配置服务地址或模型，已用本地规则拆分'
            : '网关没有返回结果，已用本地规则拆分')
      }
    } catch {
      setDrafts([])
      setNote('拆解失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  async function saveKey() {
    const key = keyDraft.trim()
    if (!key) return
    setSavingKey(true)
    try {
      const res = await window.shining.setApiKey(key)
      if (res.ok) {
        setKeyDraft('')
        await split()
      } else {
        setNote('系统加密不可用，Key 没有保存')
      }
    } finally {
      setSavingKey(false)
    }
  }

  async function commit() {
    const contents = drafts.filter((d) => d.checked).map((d) => d.content)
    if (!contents.length || confirming) return
    setConfirming(true)
    try {
      await window.shining.commitTasks(idea.id, contents)
      onClose()
    } catch {
      setNote('任务未能创建，选择已保留。')
    } finally {
      setConfirming(false)
    }
  }

  const checkedCount = drafts.filter((d) => d.checked).length

  return (
    <>
      <div className="detail-head">
        <span className="icon-tile size-8 rounded-[8px]"><Icon name="split" size={18} /></span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>拆成待办</span>
          {source === 'llm' && (
            <span className="rounded-[5px] bg-primary-soft px-1.5 py-px text-[12px] text-primary">AI · {(ms / 1000).toFixed(1)} 秒</span>
          )}
          {source === 'rule' && (
            <span className="rounded-[5px] bg-bg px-1.5 py-px text-[12px] text-sub">本地规则</span>
          )}
        </div>
        <button type="button" data-detail-focus onClick={onClose} aria-label="返回灵感详情" title="返回灵感详情" className="ui-icon-button ml-auto">
          <Icon name="arrowLeft" />
        </button>
      </div>

      <div className="detail-body min-h-0 flex-1 overflow-y-auto px-5 py-5" aria-busy={loading}>
        {needKey ? (
          <div className="space-y-3.5">
            <p className="text-[14px] leading-6 text-sub">
              配置 API Key 后可拆分这条灵感。Key 会加密保存在本机；拆分时只向模型发送这条灵感的文字。
            </p>
            <label className="block text-[13px] font-semibold text-sub">
              API Key
              <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveKey() }}
                placeholder="输入 API Key" className="ui-field mt-1.5 w-full font-normal" />
            </label>
            <button type="button" onClick={saveKey} disabled={savingKey || !keyDraft.trim()} className="ui-button" data-tone="primary">
              {savingKey ? '保存中…' : '保存并拆解'}
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden="true" className="h-7 rounded-[7px] bg-bg" style={{ width: `${88 - i * 12}%` }} />
            ))}
            <p role="status" className="text-[13px] text-muted">正在拆解…</p>
          </div>
        ) : drafts.length === 0 ? (
          <p className="text-[14px] leading-6 text-sub">
            没拆出可执行的动作。可以先把想法写具体一点，或者直接用「升格为任务」。
          </p>
        ) : (
          <>
            <p className="mb-3 text-[13px] leading-5 text-muted">勾选要创建的任务。原灵感会保留。</p>
            <ul className="space-y-2">
              {drafts.map((d, i) => (
                <li key={i}>
                  <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-[8px] border border-line bg-bg px-3 py-2.5 hover:border-line-strong">
                    <input type="checkbox" checked={d.checked} disabled={confirming}
                      onChange={(e) => setDrafts((prev) => prev.map((x, idx) => idx === i ? { ...x, checked: e.target.checked } : x))}
                      className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span className="min-w-0 wrap-anywhere text-[14px] leading-5 text-ink">{d.content}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <p role="status" className="mt-3 text-[12px] leading-5 text-muted empty:hidden">{note}</p>
      </div>

      {!needKey && (
        <div className="detail-foot flex flex-wrap items-center gap-2">
          <button type="button" onClick={commit} disabled={loading || confirming || checkedCount === 0} className="ui-button" data-tone="primary">
            {confirming ? '创建中…' : `创建 ${checkedCount} 条任务`}
          </button>
          <button type="button" onClick={split} disabled={loading || confirming} className="ui-button" data-tone="outline">
            <Icon name="refresh" size={15} /> 重新拆解
          </button>
        </div>
      )}
    </>
  )
}
