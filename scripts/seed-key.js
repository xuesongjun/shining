/**
 * 一次性把网关 Key 用系统加密（DPAPI）写进 userData/secret.bin。
 * 用法：
 *   $env:ESWIN_API_KEY="<key>"; .\node_modules\electron\dist\electron.exe scripts\seed-key.js
 * 之后应用会自己解密读取，不需要每次启动都设环境变量。
 */
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.setName('闪灵')

app.whenReady().then(async () => {
  const key = (process.env.ESWIN_API_KEY || '').trim()
  if (!key) {
    console.error('缺少 ESWIN_API_KEY')
    app.exit(1)
    return
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    console.error('系统加密不可用，放弃写入')
    app.exit(1)
    return
  }
  const file = path.join(app.getPath('userData'), 'secret.bin')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, await safeStorage.encryptStringAsync(key))
  console.log('key saved:', file)
  app.quit()
})
