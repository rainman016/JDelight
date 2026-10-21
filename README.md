# JDelight

帮助在校求职者读透一份 JD，面试前从容回看。

当前交付 WO-002 本地候选：开场 → 我的岗位 → 粘贴 JD → 校对确认 → 模拟分析 → 简版岗位页；支持标记、备注、筛选、两步删除和待分析重试。数据只存在这台设备的这个浏览器里，清理浏览器数据会丢失岗位。当前没有导出导入，请只用虚构数据验收。

## 运行

Node.js **>=24.19.0 <25**，npm **>=11.17.0**；推荐 `.nvmrc` 中的 Node 24.22.0。本次在 Node 24.19.0 / npm 11.17.0 验证。

```sh
npm ci
npm run test:install
npm run check
npm run dev
```

打开 <http://localhost:3000>。每个浏览器会话首次进入 `/` 显示开场，点击窗口进入“我的岗位”。减少动态效果时直接呈现最终态；不支持 WebGL 时保留 CSS 版本。字体自托管，构建及运行不向字体服务、CDN、遥测或 AI 发请求。不需要账号、密钥或 `.env`。

安装依赖和 Playwright Chromium 需要网络；安装完成后运行与验证不依赖外部网络。npm 缓存位于 `.cache/npm/`，浏览器安装在 `.cache/ms-playwright/`，均不提交。

| 命令                           | 用途                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `npm run dev`                  | 本地开发服务                                          |
| `npm run build`                | 生产构建                                              |
| `npm run start`                | 启动生产服务                                          |
| `npm run typecheck`            | 路由类型生成与 TypeScript strict                      |
| `npm run lint`                 | ESLint（零警告）与格式检查                            |
| `npm run format`               | 格式化代码与文档                                      |
| `npm run test`                 | Vitest、fake-indexeddb 与组件测试                     |
| `npm run test:install`         | 下载匹配的 Chromium                                   |
| `npm run test:e2e`             | 生产服务上的用户路径、真实 IndexedDB、axe 和截图      |
| `npm run check`                | typecheck → lint → test → build → test:e2e，遇错停止  |
| `node scripts/size-report.mjs` | 在 E2E 后按实际脚本请求生成各路由 JS 体积与 3D 包体积 |

端到端测试独占 `127.0.0.1:3100`，自动启停生产服务，不复用未知服务。单独运行 E2E 前先构建。日志和截图保存在 `.cache/evidence/`、`test-results/`；成功后的截图也在 `.cache/evidence/`。所有 npm 运行脚本关闭 Next 遥测。

## 验收路径与模拟边界

1. 开场进入首页，点“贴一份新的 JD”，用“试试示例”；下一步校对会自动带出虚构岗位名称、公司和地点。岗位元信息只识别明确字段，取不到留空，不猜。
2. 确认后才分析，并先把原文写入本机。进度是实际处理行数，没有假百分比或最短等待。示例 JD 对应完整七章报告夹具；本工单页面只呈现一句话解读与面试重点速览，完整报告阅读留待 WO-003。
3. 其他 JD 只返回明确标注“示例分析：真实内容由分析生成”的结构占位，不借用示例岗位的判断。本工单不调用真实模型。
4. 返回首页，标记、备注在刷新后保留。多张卡默认叠放，点卡片或“整理开”后按标记分组；可筛选。备注 Enter 或失焦保存，Esc 放弃，清空即删除；最多 60 个 Unicode 字符。删除需两次点击，失焦取消确认。
5. 校对只提示缺分区和疑似截断，不补全原文。空输入、低于 40 字或超过 12,000 字不能进入校对，输入会保留；超限不会静默截断。确认后的原文不可变；取消分析回校对时保留只读原文，可继续或返回首页稍后重试。

**唯一演示开关**：打开 <http://localhost:3000/new?demo=fail>（或首页 `/?demo=fail` 后新建），第一次模拟分析故意产生引用不匹配的报告；使用示例 JD 时还会触发“优先被写成必备”的校验失败。未通过 V1–V7 的报告不会写入或展示。点“先保存原文，稍后再试”回首页，待分析卡可重试；也可在失败页重试。本地模拟不限次数，不显示虚构的剩余真实调用次数。刷新演示地址会重新演示一次失败。

## 目录与契约

```text
src/app/               Next App Router：/、/new、/jobs/[id]
src/features/jobs/     首页、新建流程、简版岗位页
src/components/       原文纸、标记菜单、开场
src/domain/           Zod 数据结构、V1–V7、分区、标签、点亮规则
src/data/             Dexie 数据库与事务仓储
src/providers/mock/   本地模拟分析（与将来真实分析同一报告结构）
src/styles/           页面、便利贴、开场样式
src/lib/anchor/       WO-001b 已验证的中文选区锚点，留待 WO-004
fixtures/             虚构示例 JD、七章报告、四份不合格夹具
tests/                共享数据契约测试、浏览器入口、E2E
scripts/              字体子集生成、页面字集提取、体积统计
docs/变更契约/        本地数据模型、事务、失败与恢复约定
```

正式数据契约见 [本地数据模型](docs/变更契约/本地数据模型.md)。数据库 `jdelight` 结构版本 1，原文、报告不可变，删除跨四表原子执行。fake-indexeddb 与真实浏览器复用七项数据契约场景，全部使用 WO-001b 的独立测试数据库辅助函数；测试注入的故障不进入产品路径。

第一批后续工单：真实分析验证 WO-002b；完整报告与出处阅读 WO-003；提问、补充及新版本 WO-004；数据备份与导出导入 WO-005。本候选不部署、不推送、不自动开 PR。

## 字体与许可证

Instrument Serif 来自精确版本 `@fontsource/instrument-serif 5.3.0`，字体随应用自托管。手写字体 JDelight Notes 是霞鹜文楷 v1.530 的本页文字子集，完整字体不进仓库，许可证与来源位于 `public/fonts/`。

重新生成（需本机 Python 的 fonttools 与 Brotli，不增加 npm 依赖）：

```sh
python scripts/subset-font.py path/to/LXGWWenKai-Regular.ttf
```

字集由实际源码显示字符串与示例夹具生成，测试夹具不计入；动态输入里字集外的字回退本机楷体。修改过的字库已改名为 JDelight Notes，遵循 OFL。

应用代码使用 [MIT](LICENSE)，版权人 rainman016，2026。不开源发布密钥、真实 JD 或个人资料；不提交 `.env*`、依赖、缓存、构建输出或测试产物。
