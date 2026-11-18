import { useEffect, useState } from 'react'
import { Icon, PageHeading } from '../components/ui'
import type { IconName } from '../components/ui'

export default function SettingsView({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [dirChanged, setDirChanged] = useState(false)
  const [dirError, setDirError] = useState('')
  const [choosingDir, setChoosingDir] = useState(false)

  useEffect(() => {
    window.shining.settingsInfo().then((info) => {
      setBaseUrl(info.baseUrl)
      setModel(info.model)
      setHasKey(info.hasKey)
      setDataDir(info.dataDir)
    }).catch(() => {
      setStatus({ text: '无法读取设置，请返回后重新打开。', error: true })
      setDirError('无法读取数据目录。')
    })
  }, [])

  async function saveAI() {
    setSaving(true)
    setStatus(null)
    try {
      await window.shining.updateSettings({
        aiBaseUrl: baseUrl.trim(),
        aiModel: model.trim(),
      })
      if (keyDraft.trim()) {
        const res = await window.shining.setApiKey(keyDraft.trim())
        if (!res.ok) {
          setStatus({ text: '系统加密不可用，API Key 未保存。', error: true })
          return
        }
        setHasKey(true)
        setKeyDraft('')
      }
      setStatus({ text: 'AI 设置已保存' })
    } catch {
      setStatus({ text: '未能保存设置，请重试。', error: true })
    } finally {
      setSaving(false)
    }
  }

  async function fetchModels() {
    setLoadingModels(true)
    setStatus(null)
    try {
      const res = await window.shining.aiModels(baseUrl.trim(), keyDraft.trim())
      if (!res.ok) {
        const message = res.reason === 'no-key' ? '请先填写 API Key。'
          : res.reason === 'no-base-url' ? '请先填写 Base URL。' : `获取失败：${res.reason || '未知错误'}`
        setStatus({ text: message, error: true })
        return
      }
      setModels(res.models)
      if (!res.models.includes(model)) setModel(res.models[0] || '')
      setStatus({ text: res.models.length ? `已获取 ${res.models.length} 个模型` : '服务未返回可选模型。' })
    } catch {
      setStatus({ text: '无法获取模型，请检查服务地址后重试。', error: true })
    } finally {
      setLoadingModels(false)
    }
  }

  async function changeDir() {
    setChoosingDir(true)
    setDirError('')
    try {
      const next = await window.shining.pickDataDir()
      if (!next || next === dataDir) return
      setDataDir(next)
      setDirChanged(true)
    } catch {
      setDirError('无法更改目录，请检查写入权限后重试。')
    } finally {
      setChoosingDir(false)
    }
  }

  return (
    <main className="page-scroll" aria-label="设置">
      <div className="page-content">
        <PageHeading title="设置" description="配置 AI 模型与本地存储">
          <button type="button" onClick={onClose} className="ui-button" data-tone="outline"><Icon name="arrowLeft" size={16} /> 返回</button>
        </PageHeading>

        <div className="settings-grid">
          <section className="ui-surface min-w-0" aria-labelledby="ai-settings-title">
            <SettingHeading id="ai-settings-title" icon="star" title="AI 服务" description="用于拆待办、排期和生成周报。" />
            <form onSubmit={(e) => { e.preventDefault(); void saveAI() }} className="space-y-4 px-4 py-4 sm:px-5">
              <label className="block text-[13px] font-semibold text-sub">
                Base URL
                <input name="aiBaseUrl" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setModels([]) }}
                  spellCheck={false} placeholder="https://gateway.example/v1" className="ui-field mt-1.5 w-full font-normal" />
              </label>
              <label className="block text-[13px] font-semibold text-sub">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  API Key {hasKey && <span className="rounded-[5px] bg-primary-soft px-1.5 py-px text-[12px] font-medium text-primary">已配置</span>}
                </span>
                <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={hasKey ? '留空则保留现有 Key' : '粘贴 Key，加密保存在本机'} className="ui-field mt-1.5 w-full font-normal" />
              </label>
              <div>
                <label htmlFor="ai-model" className="block text-[13px] font-semibold text-sub">模型</label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} className="ui-field min-w-[9rem] flex-1">
                    {!models.length && <option value={model}>{model || '尚未获取'}</option>}
                    {models.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                  <button type="button" onClick={fetchModels} disabled={loadingModels || saving} className="ui-button" data-tone="outline">
                    <Icon name="refresh" size={15} /> {loadingModels ? '获取中…' : '获取模型'}
                  </button>
                </div>
              </div>
              <p className="text-[12px] leading-5 text-muted">使用 AI 时，正在处理的记录文字会发送到上方地址。</p>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <button type="submit" disabled={saving || loadingModels} className="ui-button" data-tone="primary">{saving ? '保存中…' : '保存 AI 设置'}</button>
                <p role="status" className={`min-w-0 text-[12px] wrap-anywhere empty:hidden ${status?.error ? 'text-danger' : 'text-primary'}`}>{status?.text}</p>
              </div>
            </form>
          </section>

          <section className="ui-surface min-w-0" aria-labelledby="data-settings-title">
            <SettingHeading id="data-settings-title" icon="storage" title="本地数据" description="闪灵的记录与图片保存在本机。" />
            <div className="space-y-3.5 px-4 py-4 sm:px-5">
              <div>
                <p className="text-[13px] font-semibold text-sub">数据目录</p>
                <p className="mt-1.5 flex min-w-0 items-start gap-2 rounded-[8px] border border-line bg-bg px-3 py-2.5 text-[13px] leading-5 text-sub">
                  <Icon name="folder" size={16} className="mt-0.5 shrink-0 text-primary" />
                  <span className="min-w-0 select-text wrap-anywhere">{dataDir || (dirError ? '目录不可用' : '正在读取…')}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={changeDir} disabled={choosingDir || !dataDir} className="ui-button" data-tone="outline">{choosingDir ? '正在选择…' : '更改目录'}</button>
                <button type="button" onClick={() => window.shining.openDataDir()} disabled={!dataDir} className="ui-button"><Icon name="folder" size={16} /> 打开目录</button>
              </div>
              <p className="text-[12px] leading-5 text-muted">更改目录会复制现有记录和图片，重启后生效。原目录会保留一份。</p>
              <p role="status" className="text-[12px] text-danger empty:hidden">{dirError}</p>
              {dirChanged && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-primary-soft p-2.5">
                  <span className="text-[12px] text-primary">重启后使用新目录</span>
                  <button type="button" onClick={() => window.shining.relaunch()} className="ui-button min-h-8" data-tone="primary">立即重启</button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function SettingHeading({ id, icon, title, description }: { id: string; icon: IconName; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-5">
      <span className="icon-tile"><Icon name={icon} size={20} /></span>
      <div className="min-w-0">
        <h2 id={id} className="text-[16px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>
      </div>
    </div>
  )
}
