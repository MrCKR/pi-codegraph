# pi-codegraph

## 安装

```bash
pi install npm:pi-codegraph
```

安装后在 pi 内执行：

```text
/reload
```

初始化并建立当前项目索引：

```text
/codegraph init
```

`/codegraph init` 是幂等命令：未初始化时会自动创建 `.codegraph/`，已初始化时会直接重建索引。

只更新本地 CodeGraph 引擎：

```text
/codegraph update
/reload
```

更新整个 pi-codegraph 扩展时：

```bash
pi update npm:pi-codegraph
```

然后：

```text
/reload
```

如果之前使用 git 安装，可以迁移到 npm 包：

```bash
pi remove git:https://github.com/MrCKR/pi-codegraph
pi install npm:pi-codegraph
```

也可以按 Git tag 固定源码版本：

```bash
pi install git:https://github.com/MrCKR/pi-codegraph@v0.1.2
```

## 这是什么

`pi-codegraph` 把 [CodeGraph](https://github.com/colbymchenry/codegraph) 接成 pi 原生扩展，提供：

- `codegraph_*` native tools
- `/codegraph <subcommand>` 命令
- 内置 CodeGraph 工具使用提示词
- `/codegraph init` / `/codegraph sync` 实时进度界面
- `/codegraph version` / `/codegraph update` 本地引擎维护命令

不需要全局安装 `codegraph`，也不需要配置 MCP。

## 命令

```text
/codegraph init       初始化并建立或重建索引，带实时进度界面
/codegraph sync       手动同步代码变动，带实时进度界面
/codegraph status     查看索引状态
/codegraph uninit     删除 .codegraph 索引
/codegraph version    查看本地 CodeGraph 引擎版本
/codegraph update     更新本地 CodeGraph 引擎
/codegraph help       查看帮助
```

## 工具

扩展会注册这些 pi 原生工具：

- `codegraph_search`
- `codegraph_context`
- `codegraph_trace`
- `codegraph_explore`
- `codegraph_node`
- `codegraph_callers`
- `codegraph_callees`
- `codegraph_impact`
- `codegraph_files`
- `codegraph_status`

## 推荐用法

问代码结构、调用链、影响范围时，优先让 agent 用 CodeGraph：

```text
这个 UI 框架是怎么打开界面的？
帮我追一下 UIManager 到 ViewBase 的调用链。
改 UIManager 会影响哪些地方？
```

## 同步策略

- session 启动时会后台执行一次 catch-up sync。
- session 运行期会启动 watcher，文件变化后自动 sync。
- 需要兜底时手动执行 `/codegraph sync`。
- 刚编辑文件后不要立刻查索引，watcher 有约 500ms～1s debounce 延迟。

## 上游 CodeGraph 更新

本包依赖 `@colbymchenry/codegraph`。已安装用户想只更新本机的 CodeGraph 引擎时，在 pi 内执行：

```text
/codegraph update
/reload
```

`/codegraph update` 会在扩展自身安装目录内更新 `@colbymchenry/codegraph` 到最新稳定版，不会修改当前项目的 `.codegraph` 索引。
维护者如果需要锁定或适配上游 API 变化，应同步更新本仓库依赖并运行：

```bash
npm run check
npm run build
```

## 注意

不要同时启用 CodeGraph MCP 和这个 pi 扩展，否则模型会看到两套 CodeGraph 工具。
