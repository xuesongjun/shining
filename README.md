# 闪灵 Shining

闪灵是一个 Windows 桌面速记工具：先记下一闪而过的想法，再整理成灵感、任务或工作留痕。无需账号，不做云同步。

## 下载

当前版本：**[v0.1.0 · Windows 预览版](https://github.com/xuesongjun/shining/releases/tag/v0.1.0)**。私有仓库的下载链接需要用有权限的 GitHub 账号打开。

1. 下载 `shining-v0.1.0-win-x64.zip`，并解压整个文件夹。
2. 双击 `Shining.exe`。这是 Windows x64 便携版，不需要安装 Node.js，也不要只把 EXE 从文件夹里移出来。
3. 关闭主窗口后，闪灵仍在系统托盘运行。要退出，请右键托盘图标，选择「退出」。

## 快速上手

| 操作 | 方法 |
| --- | --- |
| 打开闪念窗 | `Ctrl+Shift+Space` |
| 打开或隐藏主窗口 | `Ctrl+Shift+X` |
| 记为灵感 | 直接输入，按 `Enter` 保存 |
| 记为任务或留痕 | 分别用 `/t ` 或 `/r ` 开头 |
| 换行、关闭并保留草稿 | 分别按 `Shift+Enter`、`Esc` |

闪念窗和主窗口支持粘贴图片。灵感可以转为任务，任务可以设优先级、截止时间和提醒。「留痕」按天记录、按周查看。

## 数据与 AI

- 记录和图片默认保存在 `%APPDATA%\闪灵`。可在「设置」更改数据目录；关闭应用或更换便携版目录，不会把记录删掉。
- AI 是可选的。可在「设置」填写兼容服务的地址和 API Key，再获取并选择模型。没有预置真实网关。Key 加密保存在本机。
- 速记保存不等待 AI，也不发送网络请求。配置 AI 后，拆待办、任务创建后的异步排期和生成周报可能将参与处理的文字发送到所选服务；不会上传整个记录库或附件。

## 从源码运行

在 Windows x64 上准备 Node.js 22.12 或更新版本，然后在项目目录执行：

```powershell
npm ci
npm start
```

热更新开发用 `npm run dev`；数据层冒烟测试用 `npm run test:store`。

## 打包与版本

```powershell
npm run package:win
```

此命令使用已安装的 Electron 运行时生成便携 ZIP 和 SHA-256 校验文件，输出到 `release/`。只打包运行所需的文件，不包含本机配置、密钥、记录、附件或截图。

版本号以 [`package.json`](./package.json) 为准，Git 标签和 GitHub Release 使用 `v` 前缀。变更见 [CHANGELOG.md](./CHANGELOG.md)。
