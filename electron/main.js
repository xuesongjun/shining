const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell, safeStorage, Notification, protocol, net, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { Store } = require('./store')
const { splitToTasks, parseSchedules, generateReport, listModels } = require('./llm')

// 图片走自定义协议读取，dev（http://localhost）下也能加载本地文件
protocol.registerSchemesAsPrivileged([
  { scheme: 'shining-media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5173/'
const isShot = process.env.SHINING_SHOT === '1'

let mainWindow = null
let captureWindow = null
let tray = null
let store = null
let cachedApiKey
let localAiDefaults = {}

function secretPath() {
  return path.join(app.getPath('userData'), 'secret.bin')
}

/** 可选的本机网关默认值。与记录目录分开，不进入代码、构建产物或 Git。 */
function readLocalAiDefaults() {
  try {
    const file = path.join(app.getPath('userData'), 'llm.local.json')
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      baseUrl: typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '',
      model: typeof config?.model === 'string' ? config.model.trim() : '',
    }
  } catch {
    return {}
  }
}

function aiServiceConfig() {
  return {
    baseUrl: store.data.settings.aiBaseUrl || localAiDefaults.baseUrl || '',
    model: store.data.settings.aiModel || localAiDefaults.model || '',
  }
}

/** 固定的启动配置（数据目录本身可以迁走，配置文件永远留在 userData） */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function dataDir() {
  const dir = readConfig().dataDir || app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function attachmentsDir() {
  const dir = path.join(dataDir(), 'attachments')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const IMAGE_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Key 只允许来自环境变量或系统加密文件（DPAPI），绝不落进 data.json。
 */
async function readApiKey() {
  if (cachedApiKey !== undefined) return cachedApiKey
  const fromEnv = (process.env.ESWIN_API_KEY || '').trim()
  if (fromEnv) {
    cachedApiKey = fromEnv
    return cachedApiKey
  }
  try {
    if (fs.existsSync(secretPath()) && (await safeStorage.isAsyncEncryptionAvailable())) {
      const buf = fs.readFileSync(secretPath())
      let out = await safeStorage.decryptStringAsync(buf)
      if (out.shouldReEncrypt) out = await safeStorage.decryptStringAsync(buf)
      cachedApiKey = String(out.result || '').trim()
      return cachedApiKey
    }
  } catch {
    // 解密失败按未配置处理
  }
  cachedApiKey = ''
  return cachedApiKey
}

async function saveApiKey(key) {
  const clean = String(key || '').trim()
  if (!clean) return false
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    // 没有系统加密能力时宁可不存，避免明文落盘
    cachedApiKey = clean
    return false
  }
  try {
    const encrypted = await safeStorage.encryptStringAsync(clean)
    fs.writeFileSync(secretPath(), encrypted)
    cachedApiKey = clean
    return true
  } catch {
    return false
  }
}

app.setAppUserModelId('com.shining.desktop')

// 截图模式下禁用窗口遮挡节流，否则 capturePage 会抛 UnknownVizError
if (process.env.SHINING_SHOT === '1') {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

/* ---------- windows ---------- */

function rendererUrl(hash) {
  if (isDev) return `${DEV_URL}#${hash}`
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}#${hash}`
}

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#f6f6f3',
    title: '闪灵',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: baseWebPreferences(),
  })

  mainWindow.loadURL(rendererUrl('/main'))

  mainWindow.once('ready-to-show', () => {
    if (!isShot) mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 720,
    height: 132,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: baseWebPreferences(),
  })

  captureWindow.setAlwaysOnTop(true, 'screen-saver')
  captureWindow.loadURL(rendererUrl('/capture'))

  captureWindow.on('blur', () => {
    if (!isShot) captureWindow.hide()
  })
}

function positionCapture() {
  if (!captureWindow) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [w] = captureWindow.getSize()
  captureWindow.setPosition(
    Math.round(x + (width - w) / 2),
    Math.round(y + height * 0.28),
  )
}

function showCapture() {
  if (!captureWindow) createCaptureWindow()
  positionCapture()
  captureWindow.show()
  captureWindow.focus()
  captureWindow.webContents.send('capture:reset')
}

function hideCapture() {
  if (captureWindow) captureWindow.hide()
}

function showMain() {
  if (!mainWindow) return createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleMain() {
  if (!mainWindow) return createMainWindow()
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    showMain()
  }
}

/* ---------- tray ---------- */

function buildTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png')
  const image = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(image)
  tray.setToolTip('闪灵 · 闪现的灵感')

  const rebuild = () => {
    const pending = store.data.tasks.filter((t) => t.status !== 'done').length
    const menu = Menu.buildFromTemplate([
      { label: `未完成 ${pending} 条`, enabled: false },
      { type: 'separator' },
      { label: '快速记录', accelerator: 'Control+Shift+Space', click: showCapture },
      { label: '打开闪灵', click: showMain },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
    tray.setToolTip(`闪灵 · ${pending} 条未完成`)
  }

  rebuild()
  tray.on('click', toggleMain)
  store.onChange = () => { rebuild(); broadcast() }
}

/* ---------- ipc ---------- */

function broadcast() {
  const snap = store.snapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:changed', snap)
  }
}

function registerIpc() {
  ipcMain.handle('data:snapshot', () => store.snapshot())

  ipcMain.handle('idea:create', (_e, content, images) => store.createIdea(content, images))
  ipcMain.handle('idea:update', (_e, { id, patch }) => store.updateIdea(id, patch))
  ipcMain.handle('idea:delete', (_e, id) => store.deleteIdea(id))

  ipcMain.handle('task:create', async (_e, { content, ideaId, images }) => {
    const task = store.createTask(content, ideaId, images)
    if (store.data.settings.autoSchedule !== false) scheduleTasks([task.id]).catch(() => {})
    return task
  })
  ipcMain.handle('task:update', (_e, { id, patch }) => store.updateTask(id, patch))
  ipcMain.handle('task:delete', (_e, id) => store.deleteTask(id))

  ipcMain.handle('capture:hide', () => hideCapture())
  ipcMain.handle('main:show', () => { mainWindow.show(); mainWindow.focus() })
  ipcMain.handle('settings:update', (_e, patch) => {
    Object.assign(store.data.settings, patch)
    store.commit()
    if ('hotkey' in patch || 'mainHotkey' in patch) registerHotkey()
    return store.data.settings
  })

  ipcMain.handle('ai:status', async () => {
    const key = await readApiKey()
    return {
      enabled: !!store.data.settings.aiEnabled,
      configured: !!key,
      ...aiServiceConfig(),
    }
  })

  ipcMain.handle('ai:set-key', async (_e, key) => {
    const ok = await saveApiKey(key)
    return { ok, configured: !!(await readApiKey()) }
  })

  ipcMain.handle('ai:split', async (_e, text) =>
    splitToTasks({
      text,
      apiKey: await readApiKey(),
      ...aiServiceConfig(),
    }),
  )

  ipcMain.handle('idea:commit-tasks', async (_e, { ideaId, contents }) => {
    const tasks = store.promoteIdeaToTasks(ideaId, contents)
    if (store.data.settings.autoSchedule !== false && tasks.length) {
      scheduleTasks(tasks.map((t) => t.id)).catch(() => {})
    }
    return tasks
  })

  ipcMain.handle('task:schedule', (_e, id) => scheduleTasks([id], { force: true }))

  ipcMain.handle('log:create', (_e, content, images) => store.addLog(content, images))
  ipcMain.handle('log:update', (_e, { id, patch }) => store.updateLog(id, patch))
  ipcMain.handle('log:delete', (_e, id) => store.deleteLog(id))

  ipcMain.handle('report:generate', async (_e, { weekLabel, entries }) => {
    const apiKey = await readApiKey()
    return generateReport({
      entries,
      weekLabel,
      apiKey,
      ...aiServiceConfig(),
    })
  })

  ipcMain.handle('image:save', (_e, { data, mime }) => {
    const buf = Buffer.from(String(data || ''), 'base64')
    if (!buf.length || buf.length > 12 * 1024 * 1024) throw new Error('invalid image')
    const ext = IMAGE_EXT[mime] || 'png'
    const name = `${randomUUID()}.${ext}`
    fs.writeFileSync(path.join(attachmentsDir(), name), buf)
    return name
  })

  ipcMain.handle('image:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled) return []
    const names = []
    for (const file of res.filePaths) {
      const ext = (path.extname(file).slice(1) || 'png').toLowerCase()
      const name = `${randomUUID()}.${ext}`
      fs.copyFileSync(file, path.join(attachmentsDir(), name))
      names.push(name)
    }
    return names
  })

  ipcMain.handle('image:delete', (_e, name) => {
    const base = path.basename(String(name))
    const used = [...store.data.ideas, ...store.data.tasks, ...(store.data.logs || [])].some(
      (x) => Array.isArray(x.images) && x.images.includes(base),
    )
    if (used) return
    const file = path.join(attachmentsDir(), base)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  })

  ipcMain.handle('image:open', (_e, name) => {
    const file = path.join(attachmentsDir(), path.basename(String(name)))
    if (fs.existsSync(file)) shell.openPath(file)
  })

  ipcMain.handle('ai:models', async (_e, { baseUrl, apiKey } = {}) => {
    const key = String(apiKey || '').trim() || (await readApiKey())
    return listModels({ apiKey: key, baseUrl: String(baseUrl || '').trim() || aiServiceConfig().baseUrl })
  })

  ipcMain.handle('settings:info', async () => ({
    ...aiServiceConfig(),
    hasKey: !!(await readApiKey()),
    dataDir: dataDir(),
    defaultDataDir: app.getPath('userData'),
  }))

  ipcMain.handle('settings:pick-data-dir', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const target = res.filePaths[0]
    const current = dataDir()
    if (path.resolve(target) === path.resolve(current)) return current

    fs.mkdirSync(target, { recursive: true })
    const db = path.join(current, 'data.json')
    if (fs.existsSync(db)) fs.copyFileSync(db, path.join(target, 'data.json'))
    const att = path.join(current, 'attachments')
    if (fs.existsSync(att)) fs.cpSync(att, path.join(target, 'attachments'), { recursive: true })
    writeConfig({ dataDir: target })
    return target
  })

  ipcMain.handle('settings:open-data-dir', () => shell.openPath(dataDir()))

  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.on('win:control', (e, action) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'min') win.minimize()
    if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize()
    if (action === 'close') win.close()
  })
}

/* ---------- hotkey ---------- */

function registerHotkey() {
  globalShortcut.unregisterAll()

  const captureKey = store.data.settings.hotkey || 'Control+Shift+Space'
  const okCapture = globalShortcut.register(captureKey, showCapture)
  if (!okCapture) {
    // 冲突时退回到一个更冷门的组合
    globalShortcut.register('Control+Alt+Shift+Space', showCapture)
  }

  const mainKey = store.data.settings.mainHotkey || 'Control+Shift+X'
  const okMain = globalShortcut.register(mainKey, toggleMain)
  if (!okMain) {
    globalShortcut.register('Control+Alt+Shift+X', toggleMain)
  }

  console.log(
    '[hotkey]',
    captureKey,
    okCapture ? 'ok' : 'fallback',
    '|',
    mainKey,
    okMain ? 'ok' : 'fallback',
  )
}

/* ---------- AI 排期 ---------- */

/**
 * 创建任务后异步补齐截止时间。绝不阻塞捕获，失败就保持原样。
 */
async function scheduleTasks(taskIds, { force = false } = {}) {
  if (!store || !store.data.settings.aiEnabled) return []
  const apiKey = await readApiKey()
  if (!apiKey) return []

  const targets = taskIds
    .map((id) => store.data.tasks.find((t) => t.id === id))
    .filter((t) => t && (force || !t.due_at || !t.priority))
  if (!targets.length) return []

  const result = await parseSchedules({
    texts: targets.map((t) => t.content),
    apiKey,
    ...aiServiceConfig(),
  })
  if (!result) return []

  const updates = result
    .map((r, i) =>
      r && (r.due_at || r.priority)
        ? { id: targets[i].id, due_at: r.due_at, remind: r.remind, priority: r.priority }
        : null,
    )
    .filter(Boolean)
  if (!updates.length) return []

  store.applySchedule(updates, { force })
  return updates
}

/* ---------- 提醒 ---------- */

let reminderTimer = null

function checkReminders() {
  if (!store) return
  const nowMs = Date.now()
  const due = store.data.tasks.filter((t) => {
    if (!t.remind || t.status === 'done' || !t.due_at || t.notified_at) return false
    const at = new Date(t.due_at).getTime()
    return Number.isFinite(at) && at <= nowMs
  })
  if (!due.length) return

  const title = due.length === 1 ? '任务到点了' : `${due.length} 条任务到点了`
  const lines = due.slice(0, 3).map((t) => `· ${t.content}`)
  if (due.length > 3) lines.push(`…还有 ${due.length - 3} 条`)
  const note = new Notification({ title, body: lines.join('\n'), silent: false })
  note.on('click', showMain)
  note.show()

  store.markNotified(due.map((t) => t.id))
}

function startReminders() {
  if (reminderTimer) clearInterval(reminderTimer)
  checkReminders()
  // 15 秒一轮：既不会晚太多，也不至于空转
  reminderTimer = setInterval(checkReminders, 15000)
  if (reminderTimer.unref) reminderTimer.unref()
}

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    store = new Store(dataDir())
    localAiDefaults = readLocalAiDefaults()

    protocol.handle('shining-media', (request) => {
      try {
        const name = path.basename(decodeURIComponent(new URL(request.url).pathname))
        const file = path.join(attachmentsDir(), name)
        if (!fs.existsSync(file)) return new Response('not found', { status: 404 })
        return net.fetch(pathToFileURL(file).toString())
      } catch {
        return new Response('bad request', { status: 400 })
      }
    })

    registerIpc()
    createMainWindow()
    createCaptureWindow()
    buildTray()
    registerHotkey()
    startReminders()

    app.setLoginItemSettings({ openAtLogin: !!store.data.settings.launchAtLogin })

    if (isShot) {
      await runShot()
    }
  })

  app.on('window-all-closed', (e) => e.preventDefault())
  app.on('before-quit', () => { app.isQuitting = true })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}

/* ---------- screenshot mode（仅开发自检用） ---------- */

async function runShot() {
  const dir = path.join(__dirname, '..', 'shots')
  fs.mkdirSync(dir, { recursive: true })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const freeze = '*{animation:none!important;transition:none!important}'
  const shoot = async (win, file) => {
    // 首选 CDP 截图：比 capturePage 更不容易拿到过期帧
    try {
      const dbg = win.webContents.debugger
      if (!dbg.isAttached()) dbg.attach('1.3')
      await dbg.sendCommand('Page.enable').catch(() => {})
      await wait(250)
      const { data } = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        omitBackground: true,
      })
      fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'))
      return
    } catch (err) {
      console.error('cdp capture failed, falling back:', file, err.message)
    }

    let img = null
    for (let i = 0; i < 3 && !img; i++) {
      try {
        img = await win.webContents.capturePage()
        if (img.isEmpty()) img = null
      } catch {
        await wait(400)
      }
    }
    if (img) fs.writeFileSync(path.join(dir, file), img.toPNG())
    else console.error('capture failed:', file)
  }

  try {
    mainWindow.setSize(1180, 760)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.show()
    mainWindow.focus()
    await wait(600)

    // 截图前强制展开侧栏，避免上一次自检留下的折叠状态
    await mainWindow.webContents
      .executeJavaScript(`localStorage.setItem('shining:sidebar','0'); location.reload()`, true)
      .catch(() => {})
    await wait(900)
    await mainWindow.webContents.insertCSS(freeze)
    await wait(300)

    // 选中第一条，让详情面板出现在截图里
    await mainWindow.webContents
      .executeJavaScript(`document.querySelector('li div[role="button"]')?.click()`, true)
      .catch(() => {})

    await wait(500)
    await shoot(mainWindow, 'main.png')

    // 折叠态
    await mainWindow.webContents
      .executeJavaScript(
        `document.querySelector('button[aria-label="收起侧栏"]')?.click()`,
        true,
      )
      .catch(() => {})
    await wait(350)
    await shoot(mainWindow, 'collapsed.png')
    await mainWindow.webContents
      .executeJavaScript(
        `document.querySelector('button[aria-label="展开侧栏"]')?.click()`,
        true,
      )
      .catch(() => {})
    await wait(350)

    // 拆待办面板（如果有 Key，会走真模型）
    await mainWindow.webContents
      .executeJavaScript(
        `[...document.querySelectorAll('aside button')].find(b => b.textContent.trim() === '拆成待办')?.click()`,
        true,
      )
      .catch(() => {})
    await wait(2200)
    await shoot(mainWindow, 'split.png')
    await mainWindow.webContents
      .executeJavaScript(
        `[...document.querySelectorAll('aside button')].find(b => b.getAttribute('aria-label') === '关闭')?.click()`,
        true,
      )
      .catch(() => {})

    // 另外两个视图也各来一张，便于自检
    const clickNav = (label) =>
      `[...document.querySelectorAll('aside button')].find(b => b.textContent.includes('${label}'))?.click()`
    await mainWindow.webContents.executeJavaScript(clickNav('任务'), true).catch(() => {})
    await wait(350)
    await shoot(mainWindow, 'tasks.png')
    await mainWindow.webContents
      .executeJavaScript(`document.querySelector('main li div[role="button"]')?.click()`, true)
      .catch(() => {})
    await wait(300)
    await shoot(mainWindow, 'task-detail.png')
    await mainWindow.webContents.executeJavaScript(clickNav('已完成'), true).catch(() => {})
    await wait(350)
    await shoot(mainWindow, 'done.png')

    await mainWindow.webContents.executeJavaScript(clickNav('留痕'), true).catch(() => {})
    await wait(350)
    await shoot(mainWindow, 'logs.png')

    await mainWindow.webContents
      .executeJavaScript(`document.querySelector('button[aria-label="设置"]')?.click()`, true)
      .catch(() => {})
    await wait(450)
    await shoot(mainWindow, 'settings.png')

    mainWindow.setSize(900, 700)
    await wait(450)
    await shoot(mainWindow, 'settings-narrow.png')
    mainWindow.setSize(1180, 760)
    await wait(350)

    if (process.env.SHINING_TEST_REPORT === '1') {
      await mainWindow.webContents
        .executeJavaScript(
          `[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '生成周报')?.click()`,
          true,
        )
        .catch(() => {})
      await wait(6000)
      await shoot(mainWindow, 'report.png')
    }

    mainWindow.setAlwaysOnTop(false)

    showCapture()
    await captureWindow.webContents.insertCSS(freeze)
    await wait(600)
    await captureWindow.webContents
      .executeJavaScript(
        `(() => {
          const t = document.querySelector('textarea')
          if (!t) return
          const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          set.call(t, '给闪念窗加一个「按 Esc 保留草稿」的提示')
          t.dispatchEvent(new Event('input', { bubbles: true }))
          t.focus()
        })()`,
        true,
      )
      .catch(() => {})
    await wait(400)
    await shoot(captureWindow, 'capture.png')
  } catch (err) {
    console.error('shot failed:', err)
  } finally {
    app.isQuitting = true
    app.quit()
  }
}
