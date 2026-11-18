/**
 * 平台契约
 *
 * 铁律：src/ 下的任何 UI 组件都不允许 import electron / tauri 的 API。
 * 所有原生能力只能通过 window.shining 这一个接口访问。
 *
 * 换技术栈时的工作量：
 *   - 保留：src/ 全部（组件、样式、交互逻辑）
 *   - 重写：electron/main.js + electron/preload.js（约 300 行胶水）
 *   - 新增：一个等价的 bridge 实现，保持下面这组方法签名不变
 *
 * 之所以可行：Windows 上 Tauri 与 Electron 都用 WebView2（同一 Chromium 内核），
 * 因此 CSS、字体渲染、动画效果可以像素级保持一致。
 */
export {}
