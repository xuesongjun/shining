/** 本地附件通过自定义协议读取，dev 和打包后都能用 */
export function mediaUrl(name: string): string {
  return `shining-media://files/${encodeURIComponent(name)}`
}
