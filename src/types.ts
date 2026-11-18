export type IdeaStatus = 'inbox' | 'archived' | 'promoted' | 'dropped'
export type TaskStatus = 'todo' | 'done' | 'shelved'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface Idea {
  id: string
  content: string
  status: IdeaStatus
  tags: string[]
  images?: string[]
  created_at: string
  updated_at: string
  task_id?: string | null
}

export interface Task {
  id: string
  content: string
  next_action?: string
  status: TaskStatus
  tags: string[]
  images?: string[]
  idea_id?: string | null
  created_at: string
  done_at?: string | null
  due_at?: string | null
  remind?: boolean
  notified_at?: string | null
  priority?: Priority | null
}

export interface LogEntry {
  id: string
  content: string
  images?: string[]
  created_at: string
}

export interface Settings {
  hotkey: string
  mainHotkey: string
  launchAtLogin: boolean
  aiEnabled: boolean
  autoSchedule: boolean
  aiBaseUrl?: string
  aiModel?: string
}

export interface AiStatus {
  enabled: boolean
  configured: boolean
  baseUrl: string
  model: string
}

export interface SettingsInfo {
  baseUrl: string
  model: string
  hasKey: boolean
  dataDir: string
  defaultDataDir: string
}

export interface ModelsResult {
  ok: boolean
  models: string[]
  reason?: string
}

export interface SplitResult {
  tasks: string[]
  source: 'llm' | 'rule'
  reason?: string
  ms: number
}

export interface Snapshot {
  version: number
  ideas: Idea[]
  tasks: Task[]
  logs: LogEntry[]
  settings: Settings
}

declare global {
  interface Window {
    shining: {
      snapshot: () => Promise<Snapshot>
      createIdea: (content: string, images?: string[]) => Promise<Idea>
      updateIdea: (id: string, patch: Partial<Idea>) => Promise<Idea | null>
      deleteIdea: (id: string) => Promise<void>

      createTask: (content: string, ideaId?: string, images?: string[]) => Promise<Task>
      updateTask: (id: string, patch: Partial<Task>) => Promise<Task | null>
      deleteTask: (id: string) => Promise<void>

      hideCapture: () => Promise<void>
      openMain: () => Promise<void>
      updateSettings: (patch: Partial<Settings>) => Promise<Settings>
      aiStatus: () => Promise<AiStatus>
      aiModels: (baseUrl: string, apiKey: string) => Promise<ModelsResult>
      settingsInfo: () => Promise<SettingsInfo>
      pickDataDir: () => Promise<string | null>
      openDataDir: () => Promise<void>
      relaunch: () => Promise<void>
      setApiKey: (key: string) => Promise<{ ok: boolean; configured: boolean }>
      splitIdea: (text: string) => Promise<SplitResult>
      scheduleTask: (id: string) => Promise<{ id: string; due_at: string; remind: boolean }[]>
      commitTasks: (ideaId: string, contents: string[]) => Promise<Task[]>

      createLog: (content: string, images?: string[]) => Promise<LogEntry>
      updateLog: (id: string, patch: Partial<LogEntry>) => Promise<LogEntry | null>
      deleteLog: (id: string) => Promise<void>
      generateReport: (weekLabel: string, entries: string[]) => Promise<string | null>

      saveImage: (data: string, mime: string) => Promise<string>
      pickImages: () => Promise<string[]>
      deleteImage: (name: string) => Promise<void>
      openImage: (name: string) => Promise<void>
      windowControl: (action: 'min' | 'max' | 'close') => void

      onChanged: (cb: (snap: Snapshot) => void) => () => void
      onCaptureReset: (cb: () => void) => () => void
    }
  }
}
