const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const manifest = require('../package.json')

const root = path.resolve(__dirname, '..')
const runtime = path.join(root, 'node_modules', 'electron', 'dist')
const output = path.join(root, 'release')

// 从 Electron 发行包选取运行时。不要把项目目录、环境文件或 userData 整体复制进来。
const runtimeFiles = [
  'LICENSE', 'LICENSES.chromium.html', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'd3dcompiler_47.dll', 'dxcompiler.dll', 'electron_wer.dll', 'ffmpeg.dll', 'icudtl.dat',
  'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version',
  'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll',
]
const appFiles = [
  'electron/main.js', 'electron/preload.js', 'electron/store.js', 'electron/llm.js',
  'assets/icon.png', 'assets/tray.png', 'dist/index.html',
]

function copyFile(source, dest) {
  if (!fs.lstatSync(source).isFile()) throw new Error(`预期为普通文件：${source}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL)
}

function assertWinX64(exe) {
  const fd = fs.openSync(exe, 'r')
  try {
    const header = Buffer.alloc(64)
    const signature = Buffer.alloc(6)
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length || header.readUInt16LE(0) !== 0x5a4d ||
        fs.readSync(fd, signature, 0, signature.length, header.readUInt32LE(0x3c)) !== signature.length ||
        signature.readUInt32LE(0) !== 0x4550 || signature.readUInt16LE(4) !== 0x8664) {
      throw new Error('已安装的 Electron 不包含 Windows x64 运行时。')
    }
  } finally {
    fs.closeSync(fd)
  }
}

async function writeLauncher(source, dest) {
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit')
  // 只生成便携包里的启动器；不修改 node_modules 里的 Electron。生成的应用未做 Authenticode 签名。
  const executable = NtExecutable.from(fs.readFileSync(source), { ignoreCert: true })
  const resource = NtExecutableResource.from(executable)
  const icons = ['tray.png', 'icon@64.png', 'icon.png'].map((file) => {
    const png = fs.readFileSync(path.join(root, 'assets', file))
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    return Data.RawIconItem.from(png, width, height, 32)
  })
  const groups = Resource.IconGroupEntry.fromEntries(resource.entries)
  for (const { id, lang } of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    Resource.IconGroupEntry.replaceIconsForResource(resource.entries, id, lang, icons)
  }

  const [major, minor, patch] = manifest.version.split('-')[0].split('.').map(Number)
  for (const info of Resource.VersionInfo.fromEntries(resource.entries)) {
    for (const lang of info.getAllLanguagesForStringValues()) {
      info.setFileVersion(major, minor, patch, 0, lang.lang)
      info.setProductVersion(major, minor, patch, 0, lang.lang)
      info.setStringValues(lang, {
        FileDescription: manifest.productName,
        ProductName: manifest.productName,
        ProductVersion: manifest.version,
        InternalName: 'Shining',
        OriginalFilename: 'Shining.exe',
      })
    }
    info.outputToResourceEntries(resource.entries)
  }

  resource.outputResource(executable)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(executable.generate()), { flag: 'wx' })
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

async function main() {
  if (process.platform !== 'win32') throw new Error('请在 Windows 上打包。')
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version)) throw new Error('package.json 的版本号不符合 SemVer 格式。')
  const basename = `shining-v${manifest.version}-win-x64`
  const zipName = `${basename}.zip`
  const archive = path.join(output, zipName)
  const checksum = `${archive}.sha256`
  if (fs.existsSync(archive) || fs.existsSync(checksum)) throw new Error('同版本发布文件已存在。请先移走它，或打包下一个版本。')

  const exe = path.join(runtime, 'electron.exe')
  assertWinX64(exe)
  const electronVersion = require('electron/package.json').version
  if (fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim().replace(/^v/, '') !== electronVersion) {
    throw new Error('Electron 运行时与已安装的 Electron 版本不一致。')
  }
  const bundles = fs.readdirSync(path.join(root, 'dist', 'assets'))
  if (!bundles.length || !bundles.some((file) => file.endsWith('.js')) || bundles.some((file) => !/^index-[a-z0-9_-]+\.(?:js|css)$/i.test(file))) {
    throw new Error('dist/assets 中包含非预期文件，或未找到构建后的 JS。')
  }

  fs.mkdirSync(output, { recursive: true })
  const staging = fs.mkdtempSync(path.join(output, '.win-x64-'))
  try {
    const portable = path.join(staging, basename)
    const appDir = path.join(portable, 'resources', 'app')
    await writeLauncher(exe, path.join(portable, 'Shining.exe'))
    for (const file of runtimeFiles) copyFile(path.join(runtime, file), path.join(portable, file))
    for (const locale of fs.readdirSync(path.join(runtime, 'locales'))) {
      if (/^[a-z0-9-]+\.pak$/i.test(locale)) copyFile(path.join(runtime, 'locales', locale), path.join(portable, 'locales', locale))
    }
    for (const file of ['README.md', 'CHANGELOG.md']) copyFile(path.join(root, file), path.join(portable, file))
    for (const file of [...appFiles, ...bundles.map((file) => `dist/assets/${file}`)]) copyFile(path.join(root, file), path.join(appDir, file))

    const { name, productName, version, description, main: entry } = manifest
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name, productName, version, description, main: entry, private: true }, null, 2) + '\n', { flag: 'wx' })

    const result = spawnSync('tar.exe', ['-caf', zipName, basename], { cwd: staging, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`创建 ZIP 失败，tar 退出码：${result.status}`)
    const stagedZip = path.join(staging, zipName)
    const hash = await sha256(stagedZip)
    fs.copyFileSync(stagedZip, archive, fs.constants.COPYFILE_EXCL)
    fs.writeFileSync(checksum, `${hash}  ${zipName}\n`, { flag: 'wx' })
    console.log(`便携包：release/${zipName}\nSHA-256：${hash}`)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`打包失败：${err.message}`)
  process.exitCode = 1
})
