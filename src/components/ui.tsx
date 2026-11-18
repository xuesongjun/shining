import type { ReactNode } from 'react'
import { mediaUrl } from '../lib/media'
import type { Priority } from '../types'

const star = 'M12 2.25c.6 6.05 3.7 9.15 9.75 9.75-6.05.6-9.15 3.7-9.75 9.75C11.4 15.7 8.3 12.6 2.25 12 8.3 11.4 11.4 8.3 12 2.25z'

const icons = {
  star: <path d={star} />,
  idea: <path d={star} stroke="none" fill="currentColor" />,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 12 2.6 2.6L16 9" /></>,
  journal: <><path d="M6 20V6a2 2 0 0 1 2-2h11v16H8a2 2 0 1 1 0-4h11M10 8h5m-5 4h5" /></>,
  done: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.6 2.6L16 9" /></>,
  settings: <><path d="M9.5 4.5 10.2 2.8h3.6l.7 1.7 1.4.8 1.8-.3 1.8 3.1-1.1 1.4v1.7l1.1 1.4-1.8 3.1-1.8-.3-1.4.8-.7 1.7h-3.6l-.7-1.7-1.4-.8-1.8.3-1.8-3.1 1.1-1.4V9.5L4.5 8.1 6.3 5l1.8.3z" transform="translate(0 1.6)" /><circle cx="12" cy="12" r="3" /></>,
  sidebar: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M9 5v14" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4 4" /></>,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M10.3 10h.01m3.4 0h.01M17 10h.01M7 14h.01m3 0h4m3 0h.01" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="3" /><path d="M8 3.5v4m8-4v4m-12 3h16M9 15h2m3 0h1" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.75" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  split: <><path d="M6 12h4m0 0c3 0 3-6 6-6h2m-8 6c3 0 3 6 6 6h2" /><path d="m16 4 2 2-2 2m0 8 2 2-2 2" /><circle cx="4.5" cy="12" r="1.5" /></>,
  promote: <><path d="M10 5h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3m5.5-3 2 2 3-4" /><path d="M2.5 9h7m-3-3 3 3-3 3" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  arrowLeft: <path d="M19 12H5m5 5-5-5 5-5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  image: <><rect x="4" y="4.5" width="16" height="15" rx="3" /><circle cx="9" cy="9.5" r="1.25" /><path d="m5 17 4.5-4 3 2.5 3.6-4 3.4 3.5" /></>,
  archive: <><rect x="4" y="4.5" width="16" height="4" rx="1" /><path d="M6 8.5v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9m-8 4h4" /></>,
  trash: <><path d="M4.5 6h15m-13 0 1 12a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2l1-12m-8 0V4h5v2m-4.5 4v6m4-6v6" /></>,
  edit: <path d="m5 15 10-10a2.8 2.8 0 0 1 4 4L9 19l-4 1 1-5Zm8.8-8.8 4 4" />,
  folder: <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
  storage: <><ellipse cx="12" cy="6.5" rx="7.5" ry="3" /><path d="M4.5 6.5v11c0 1.65 3.35 3 7.5 3s7.5-1.35 7.5-3v-11M4.5 12c0 1.65 3.35 3 7.5 3s7.5-1.35 7.5-3" /></>,
  refresh: <path d="M19.5 9.5A8 8 0 0 0 6 6l-2.5 2m0-4v4H8m-3.5 6.5A8 8 0 0 0 18 18l2.5-2m0 4v-4H16" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 4H6a2 2 0 0 0-2 2v10" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof icons

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {icons[name]}
    </svg>
  )
}

export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`}><Icon name="idea" size={20} /></span>
}

export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className="keycap">{children}</kbd>
}

export const PRIORITY_LABEL: Record<Priority, string> = { low: '低', medium: '中', high: '高', urgent: '极' }

export function PriorityChip({ priority }: { priority: Priority }) {
  return <span className="priority-chip" data-priority={priority}>{PRIORITY_LABEL[priority]}</span>
}

export function PageHeading({ title, description, children, compact }: { title: string; description?: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className="page-heading">
      <div className={compact ? 'page-heading-inline min-w-0' : 'min-w-0'}>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}

export function AttachmentThumb({ name, size, onOpen, onRemove, removeLabel = '移除图片', disabled }: {
  name: string
  size: 'draft' | 'detail' | 'capture'
  onOpen?: () => void
  onRemove: () => void
  removeLabel?: string
  disabled?: boolean
}) {
  const image = <img src={mediaUrl(name)} alt="" className="attachment-image" />
  return (
    <div className="attachment-thumb" data-size={size}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label="打开图片" title="打开图片" className="attachment-open">
          {image}
        </button>
      ) : image}
      <button type="button" onClick={onRemove} disabled={disabled} aria-label={removeLabel} title={removeLabel} className="attachment-remove">
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
