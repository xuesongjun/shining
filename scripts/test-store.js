const os = require('os'), fs = require('fs'), path = require('path')
const { Store } = require('../electron/store')
const { ruleSplit, parseTasks } = require('../electron/llm')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shining-'))
const s = new Store(dir)
const idea = s.createIdea('下周要给闪灵加个全局快捷键，还要写导出功能')
const tasks = s.promoteIdeaToTasks(idea.id, ['加全局快捷键', '写导出功能'])
const reloaded = new Store(dir)
console.log('STORE tasks=', tasks.length, 'ideaStatus=', reloaded.data.ideas[0].status, 'persistedTasks=', reloaded.data.tasks.length)

const rule = ruleSplit('下周要给闪灵加个全局快捷键，还要写导出功能，顺便调研一下 Tauri 的打包体积，另外那个配色我挺喜欢的别忘了。')
console.log('RULE:', JSON.stringify(rule, null, 0))

const fenced = '```json\n[{"content":"加全局快捷键"},{"content":"写导出功能"}]\n```'
console.log('PARSE fenced:', JSON.stringify(parseTasks(fenced)))
console.log('PARSE garbage:', JSON.stringify(parseTasks('抱歉，我无法完成')))
console.log('PARSE obj:', JSON.stringify(parseTasks('{"content":"单条"}')))
