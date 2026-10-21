# JDelight

帮助在校求职者读透一份 JD，面试前从容回看。

当前仅交付脚手架与最小页面。第一批不接 AI，计划采用模拟数据；数据只保存在这台设备的这个浏览器里。当前骨架尚无数据读写功能，不需要账号、密钥或环境变量。

## 运行要求

- Node.js **>=24.19.0 <25**（Node 24 LTS；推荐使用 `.nvmrc` 中的 **24.22.0**）。
- npm **>=11.17.0**。保留严格引擎检查，本机已有的 Node 24.19.0 / npm 11.17.0 满足要求，无需升级补丁版本即可安装。
- 安装依赖与 Chromium 需要网络；安装完成后的构建、运行和检查不依赖外部网络服务。

## 安装与命令

```sh
npm ci
npm run test:install
npm run check
```

`test:install` 安装 Playwright 配套的 Chromium 到仓库内 `.cache/ms-playwright/`。Linux 如缺少浏览器系统库，按 Playwright 官方说明准备运行环境；本项目在 Windows 上验证。npm 缓存也保存在仓库内 `.cache/npm/`。

开发时运行：

```sh
npm run dev
```

打开 <http://localhost:3000>，应看到 JDelight 标题、骨架就绪说明和本地数据提示。

| 命令                   | 用途                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm run dev`          | 启动开发服务                                                           |
| `npm run build`        | 生成生产构建                                                           |
| `npm run start`        | 启动已构建的生产服务                                                   |
| `npm run typecheck`    | 生成 Next 路由类型并执行严格类型检查                                   |
| `npm run lint`         | ESLint（Next 推荐配置）与格式检查，警告也视为失败                      |
| `npm run format`       | 使用 Prettier 格式化源码与文档                                         |
| `npm run format:check` | 只检查格式                                                             |
| `npm run test`         | Vitest + Testing Library 单元测试                                      |
| `npm run test:install` | 安装端到端测试所用 Chromium                                            |
| `npm run test:e2e`     | 在生产服务上执行 Playwright + axe 冒烟测试                             |
| `npm run check`        | 依次运行 typecheck → lint（含格式）→ test → build → test:e2e；遇错即停 |

所有脚本均通过跨平台环境变量关闭 Next.js 遥测（`NEXT_TELEMETRY_DISABLED=1`）。页面使用本机字体，没有外部字体、CDN、分析服务或 AI 请求。不需要 `.env`。

单独运行 `test:e2e` 前需先运行 `build`。端到端测试独占 `127.0.0.1:3100`，自动启停生产服务；若该端口已占用，测试会报错，不复用未知服务。

## 目录约定

以下包含后续工单的规划目录；当前只创建已使用的目录，不预建空壳。

```text
src/
  app/                   页面与路由
  features/jobs/         岗位：新建、列表、标记、删除
  features/reports/      报告阅读、版本、速览
  features/annotations/  选中提问与批注
  domain/                数据契约（Zod）与 repository 接口，不依赖 Next 或 Dexie
  data/                  Dexie 实现、升级、导入导出
  providers/mock/        预设分析与回答
  styles/                token、正文、打印
tests/                   端到端与集成测试
fixtures/                虚构 JD，不使用真实 JD
```

当前首页及颜色、字体 token 在 `src/app/`；单元测试与页面同目录，测试初始化在 `tests/setup.ts`，端到端冒烟在 `tests/e2e/`。CSS 变量是颜色与字体值的来源，Tailwind 主题引用这些变量。

不提交依赖、缓存、构建输出、测试产物、`.env*`、真实 JD 或个人资料。当前没有 Dexie、组件库、真实 AI、持续集成或部署配置。

## 许可证

[MIT](LICENSE)，版权人 rainman016，2026。
