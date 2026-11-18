import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { fileToBase64, imageFilesFromClipboard } from '../lib/clipboard'
import { AttachmentThumb, BrandMark, Icon, Keycap } from '../components/ui'

export default function Capture() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pasting, setPasting] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const pasteInFlight = useRef(false)

  useEffect(() => {
    const focus = () => {
      setSaved(false)
      requestAnimationFrame(() => ref.current?.focus())
    }
    focus()
    return window.shining.onCaptureReset(focus)
  }, [])

  const trimmed = value.trimStart()
  const kind: 'idea' | 'task' | 'log' = trimmed.startsWith('/t ')
    ? 'task'
    : trimmed.startsWith('/r ')
      ? 'log'
      : 'idea'
  const content = (kind === 'idea' ? trimmed : trimmed.slice(3)).trim()
  const ready = !!content || images.length > 0

  async function addPastedImages(e: ClipboardEvent) {
    const files = imageFilesFromClipboard(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    if (pasteInFlight.current) return
    pasteInFlight.current = true
    setPasting(true)
    setError('')
    try {
      for (const file of files) {
        try {
          const name = await window.shining.saveImage(await fileToBase64(file), file.type)
          setImages((prev) => [...prev, name])
        } catch {
          setError('图片未能保存')
        }
      }
    } finally {
      pasteInFlight.current = false
      setPasting(false)
    }
  }

  useEffect(() => {
    // 窗口级粘贴：焦点在哪都能贴截图
    const handler = (e: ClipboardEvent) => {
      void addPastedImages(e)
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [])

  async function submit() {
    if (!ready || busy || saved || pasteInFlight.current) return
    setBusy(true)
    setError('')
    try {
      if (kind === 'task') {
        await window.shining.createTask(content || '图片', undefined, images)
      } else if (kind === 'log') {
        await window.shining.createLog(content || '图片', images)
      } else {
        await window.shining.createIdea(content || '图片', images)
      }
      setSaved(true)
      setValue('')
      setImages([])
      setTimeout(() => {
        setSaved(false)
        window.shining.hideCapture()
      }, 170)
    } catch {
      setError('没有保存，草稿已保留')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      window.shining.hideCapture()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="capture-shell" onKeyDown={(e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) void window.shining.hideCapture()
    }}>
      <div className="capture-card" data-saved={saved}>
        <div className="capture-body">
          <BrandMark />
          <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown}
            rows={1} maxLength={2000} placeholder="想到什么，直接写下来…" aria-label="记录灵感"
            className="entry-input capture-input block min-w-0 flex-1" />
          {!!images.length && (
            <div className="capture-images" aria-label={`${images.length} 张待保存图片`}>
              {images.map((name) => (
                <AttachmentThumb key={name} name={name} size="capture" disabled={busy} onRemove={() => {
                  setImages((prev) => prev.filter((x) => x !== name))
                  void window.shining.deleteImage(name).catch(() => {})
                  ref.current?.focus({ preventScroll: true })
                }} />
              ))}
            </div>
          )}
        </div>

        <div className="capture-footer">
          <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2 py-1 font-semibold ${kind === 'idea' && !saved ? 'bg-idea-soft text-idea-ink' : 'bg-primary-soft text-primary'}`}>
            <Icon name={saved ? 'check' : kind === 'task' ? 'tasks' : kind === 'log' ? 'journal' : 'idea'} size={14} className={kind === 'idea' && !saved ? 'text-idea' : undefined} />
            {saved ? '已记下' : kind === 'task' ? '存为任务' : kind === 'log' ? '存为留痕' : '存为灵感'}
          </span>
          {error ? <span role="alert" className="min-w-0 text-danger">{error}</span> : (
            <div className="capture-help flex items-center gap-3">
              <span><code className="text-sub">/t</code> 任务</span>
              <span><code className="text-sub">/r</code> 留痕</span>
              <span><code className="text-sub">#</code> 标签</span>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <span className="capture-help whitespace-nowrap"><Keycap>Esc</Keycap> 关闭</span>
            <button type="button" onClick={submit} disabled={!ready || pasting || busy || saved} className="ui-button text-[12px]" data-tone="primary">
              <span className="capture-help text-[11.5px] font-normal opacity-90">Enter</span> 记下
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
