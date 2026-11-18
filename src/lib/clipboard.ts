/**
 * 从剪贴板取出图片。
 *
 * 只读 clipboardData.files 会漏掉一部分来源：从截图工具复制的位图，
 * 在 Chromium 里常以 items(kind='file') 出现而 files 为空，两个都要读。
 */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()

  const push = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    const key = `${file.name}:${file.size}:${file.type}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }

  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) push(item.getAsFile())
  }
  for (const file of Array.from(data.files || [])) push(file)

  return out
}

/** File -> base64（跨 contextBridge 传 ArrayBuffer 不稳，统一走字符串） */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
