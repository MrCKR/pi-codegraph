/**
 * 功能：把 CodeGraph 注册为 pi 原生工具与 /codegraph 子命令
 * 实现者：alps
 * 实现日期：2026-05-26
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	loadCodeGraphRuntime,
	type CodeGraphInstance,
	type ToolDefinition,
	type ToolHandler,
} from "./codegraph-runtime.js";
import { CodeGraphProgressComponent, formatProgress, type ProgressMessage } from "./progress-component.js";

const CODEGRAPH_COMMANDS = ["init", "index", "sync", "status", "uninit", "help"] as const;
type CodeGraphCommand = (typeof CODEGRAPH_COMMANDS)[number];

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const WORKER_PROGRESS_INTERVAL_MS = 500;
const CUSTOM_UI_COMMANDS = new Set<Exclude<CodeGraphCommand, "help">>(["index", "sync"]);

interface RuntimeState {
	handler?: ToolHandler;
	defaultProject?: string;
	watcherProject?: string;
	watcher?: CodeGraphInstance;
}

/** 把 MCP JSON Schema 转为 pi 可接受的 TypeBox schema。 */
function toTypeBoxSchema(tool: ToolDefinition) {
	return Type.Unsafe<Record<string, unknown>>(tool.inputSchema as never);
}

/** 按空白切分命令参数，保留简单引号内容。 */
function splitArgs(input: string): string[] {
	const args: string[] = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(input)) !== null) {
		args.push(match[1] ?? match[2] ?? match[3] ?? "");
	}
	return args;
}

interface WorkerMessage {
	type: "start" | "progress" | "result" | "error";
	command: Exclude<CodeGraphCommand, "help">;
	message?: string;
	phase?: string;
	current?: number;
	total?: number;
	currentFile?: string;
	data?: unknown;
}

interface WorkerResult {
	code: number;
	messages: WorkerMessage[];
	result?: WorkerMessage;
	error?: WorkerMessage;
}


interface WorkerRunOptions {
	onMessage?: (message: WorkerMessage) => void;
	onProgressText?: (text: string) => void;
}

/** 启动 CodeGraph worker 子进程。 */
type WorkerProcess = ChildProcessByStdio<null, Readable, Readable>;

function spawnCodegraphWorker(
	ctx: ExtensionCommandContext,
	command: Exclude<CodeGraphCommand, "help">,
	args: string[],
): WorkerProcess {
	const runtime = loadCodeGraphRuntime();
	const commandArgs = [...runtime.workerArgsPrefix, command, ctx.cwd, ...args];
	return spawn(runtime.workerCommand, commandArgs, {
		cwd: ctx.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** 监听 worker 输出并解析 JSON Lines 进度。 */
function watchWorkerProcess(
	proc: WorkerProcess,
	command: Exclude<CodeGraphCommand, "help">,
	options: WorkerRunOptions = {},
): Promise<WorkerResult> {
	const messages: WorkerMessage[] = [];
	let resultMessage: WorkerMessage | undefined;
	let errorMessage: WorkerMessage | undefined;
	let pendingLine = "";
	let stderr = "";

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			proc.kill("SIGTERM");
		}, COMMAND_TIMEOUT_MS);

		const consumeLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const message = JSON.parse(line) as WorkerMessage;
				messages.push(message);
				options.onMessage?.(message);
				if (message.type === "progress" || message.type === "start") {
					options.onProgressText?.(formatProgress(message));
				} else if (message.type === "result") {
					resultMessage = message;
				} else if (message.type === "error") {
					errorMessage = message;
				}
			} catch {
				stderr += `${line}\n`;
			}
		};

		proc.stdout.on("data", (chunk) => {
			pendingLine += chunk.toString();
			const lines = pendingLine.split(/\r?\n/);
			pendingLine = lines.pop() ?? "";
			for (const line of lines) consumeLine(line);
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", (error) => {
			clearTimeout(timeout);
			resolve({ code: 1, messages, error: { type: "error", command, message: error.message } });
		});
		proc.on("close", (code) => {
			clearTimeout(timeout);
			if (pendingLine.trim()) consumeLine(pendingLine);
			if (!errorMessage && code !== 0 && stderr.trim()) {
				errorMessage = { type: "error", command, message: stderr.trim() };
			}
			resolve({ code: code ?? 1, messages, result: resultMessage, error: errorMessage });
		});
	});
}

/** 运行 CodeGraph worker，并用 footer 状态展示轻量进度。 */
async function runCodegraphWorker(
	ctx: ExtensionCommandContext,
	command: Exclude<CodeGraphCommand, "help">,
	args: string[],
): Promise<WorkerResult> {
	let lastProgressText = "working...";
	let lastUpdateAt = 0;
	const proc = spawnCodegraphWorker(ctx, command, args);
	const heartbeat = setInterval(() => {
		ctx.ui.setStatus("codegraph", `CodeGraph ${command}: ${lastProgressText}`);
	}, 5000);

	try {
		return await watchWorkerProcess(proc, command, {
			onProgressText: (text) => {
				lastProgressText = text;
				const now = Date.now();
				if (now - lastUpdateAt < WORKER_PROGRESS_INTERVAL_MS) return;
				lastUpdateAt = now;
				ctx.ui.setStatus("codegraph", `CodeGraph ${command}: ${text}`);
			},
		});
	} finally {
		clearInterval(heartbeat);
	}
}

/** 用自定义 TUI 组件运行 CodeGraph 长任务，确保进度实时可见。 */
async function runCodegraphWorkerWithCustomUi(
	ctx: ExtensionCommandContext,
	command: Exclude<CodeGraphCommand, "help">,
	args: string[],
): Promise<WorkerResult> {
	if (!ctx.hasUI) return runCodegraphWorker(ctx, command, args);

	return ctx.ui.custom<WorkerResult>((tui, theme, _keybindings, done) => {
		const component = new CodeGraphProgressComponent(tui, theme, command);
		const proc = spawnCodegraphWorker(ctx, command, args);
		let completed = false;

		component.onCancel = () => {
			if (completed) return;
			completed = true;
			proc.kill("SIGTERM");
			done({
				code: 130,
				messages: [],
				error: { type: "error", command, message: "用户取消" },
			});
		};

		let lastRenderAt = 0;
		void watchWorkerProcess(proc, command, {
			onMessage: (message) => {
				if (message.type !== "progress") {
					component.update(message);
					return;
				}
				const now = Date.now();
				if (now - lastRenderAt < WORKER_PROGRESS_INTERVAL_MS) return;
				lastRenderAt = now;
				component.update(message);
			},
		}).then((result) => {
			if (completed) return;
			completed = true;
			done(result);
		}).catch((error: unknown) => {
			if (completed) return;
			completed = true;
			const message = error instanceof Error ? error.message : String(error);
			done({
				code: 1,
				messages: [],
				error: { type: "error", command, message },
			});
		});

		return component;
	});
}

/** 返回当前目录往上的 CodeGraph 根目录。 */
function findProjectRoot(cwd: string): string | null {
	const runtime = loadCodeGraphRuntime();
	return runtime.codegraph.findNearestCodeGraphRoot(cwd);
}

/** 关闭当前查询 handler 和 watcher。 */
function closeState(state: RuntimeState): void {
	try {
		state.handler?.closeAll();
	} catch {
		// 关闭失败不影响 pi 退出或 reload。
	}
	try {
		state.watcher?.close();
	} catch {
		// watcher 只是辅助同步，清理失败时忽略。
	}
	state.handler = undefined;
	state.defaultProject = undefined;
	state.watcher = undefined;
	state.watcherProject = undefined;
}

/** 打开或复用当前项目的 ToolHandler。 */
function getToolHandler(state: RuntimeState, ctx: ExtensionContext): ToolHandler {
	const runtime = loadCodeGraphRuntime();
	const root = findProjectRoot(ctx.cwd);

	if (state.handler && state.defaultProject === root) {
		return state.handler;
	}

	try {
		state.handler?.closeAll();
	} catch {
		// 切换项目时尽量清理旧连接，失败不阻断新连接。
	}

	if (!root) {
		state.handler = new runtime.toolsModule.ToolHandler(null);
		state.handler.setDefaultProjectHint(ctx.cwd);
		state.defaultProject = undefined;
		return state.handler;
	}

	const cg = runtime.codegraphClass.openSync(root);
	state.handler = new runtime.toolsModule.ToolHandler(cg);
	state.handler.setDefaultProjectHint(root);
	state.defaultProject = root;
	return state.handler;
}

/** 后台补齐关闭期间的代码变动。 */
async function catchUpSync(state: RuntimeState, ctx: ExtensionContext): Promise<void> {
	const root = findProjectRoot(ctx.cwd);
	if (!root) return;

	const runtime = loadCodeGraphRuntime();
	try {
		const cg = await runtime.codegraphClass.open(root);
		const result = await cg.sync();
		const changed = result.filesAdded + result.filesModified + result.filesRemoved;
		cg.close();
		if (changed > 0) {
			ctx.ui.setStatus("codegraph", `CodeGraph synced ${changed} files`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.setStatus("codegraph", `CodeGraph sync failed: ${message}`);
	} finally {
		// sync 可能重建连接；丢弃旧 handler，下次 tool call 重新打开。
		try {
			state.handler?.closeAll();
		} catch {
			// 清理失败不影响后续懒加载。
		}
		state.handler = undefined;
		state.defaultProject = undefined;
	}
}

/** 启动文件 watcher，让索引跟随代码库变动自动同步。 */
async function startWatcher(state: RuntimeState, ctx: ExtensionContext): Promise<void> {
	const root = findProjectRoot(ctx.cwd);
	if (!root || state.watcherProject === root) return;

	try {
		state.watcher?.close();
	} catch {
		// 切换项目时尽量关闭旧 watcher。
	}

	const runtime = loadCodeGraphRuntime();
	try {
		const cg = await runtime.codegraphClass.open(root);
		const started = cg.watch({
			onSyncComplete: (result: { filesChanged: number; durationMs: number }) => {
				if (result.filesChanged > 0) {
					ctx.ui.setStatus("codegraph", `CodeGraph synced ${result.filesChanged} files`);
				}
			},
			onSyncError: (error: Error) => {
				ctx.ui.setStatus("codegraph", `CodeGraph watcher error: ${error.message}`);
			},
		});

		state.watcher = cg;
		state.watcherProject = root;
		ctx.ui.setStatus("codegraph", started ? "CodeGraph watcher active" : "CodeGraph watcher unavailable");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.setStatus("codegraph", `CodeGraph watcher failed: ${message}`);
	}
}

/** 显示 /codegraph 的帮助文本。 */
function showHelp(ctx: ExtensionCommandContext): void {
	ctx.ui.notify(
		[
			"CodeGraph 命令：",
			"/codegraph init       初始化当前项目",
			"/codegraph index      建立或重建索引",
			"/codegraph sync       手动同步代码变动",
			"/codegraph status     查看索引状态",
			"/codegraph uninit     删除 .codegraph 索引",
			"/codegraph help       查看帮助",
		].join("\n"),
		"info",
	);
}

/** 格式化字节大小。 */
function formatBytes(bytes: number | undefined): string {
	if (!bytes || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index++;
	}
	return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

/** 格式化 status JSON 输出。 */
function formatStatusSummary(json: unknown): string | undefined {
	if (!json || typeof json !== "object") return undefined;
	const data = json as Record<string, any>;
	if (!data.initialized) {
		return [`CodeGraph 未初始化`, `项目：${data.projectPath ?? "当前目录"}`, "下一步：/codegraph init"].join("\n");
	}

	const pending = data.pendingChanges ?? {};
	return [
		"CodeGraph 状态：已初始化",
		`项目：${data.projectPath}`,
		`文件：${data.fileCount?.toLocaleString?.() ?? data.fileCount}`,
		`节点：${data.nodeCount?.toLocaleString?.() ?? data.nodeCount}`,
		`边：${data.edgeCount?.toLocaleString?.() ?? data.edgeCount}`,
		`数据库：${formatBytes(data.dbSizeBytes)}`,
		`后端：${data.backend ?? "unknown"} / journal=${data.journalMode ?? "unknown"}`,
		`待同步：+${pending.added ?? 0} ~${pending.modified ?? 0} -${pending.removed ?? 0}`,
	].join("\n");
}

/** 格式化 init 结果。 */
function formatInitSummary(result: WorkerResult): string {
	const data = (result.result?.data ?? {}) as Record<string, any>;
	if (data.alreadyInitialized) {
		return ["CodeGraph 已初始化，无需重复 init。", `项目：${data.projectPath}`, "下一步：/codegraph status 或 /codegraph sync"].join("\n");
	}
	return ["CodeGraph 初始化完成。", data.projectPath ? `项目：${data.projectPath}` : undefined, "下一步：/codegraph index"].filter(Boolean).join("\n");
}

/** 格式化 index 结果。 */
function formatIndexSummary(result: WorkerResult): string {
	const data = (result.result?.data ?? {}) as Record<string, any>;
	return [
		data.success === false ? "CodeGraph 索引失败。" : "CodeGraph 索引完成。",
		`文件：${(data.filesIndexed ?? 0).toLocaleString()} indexed，${(data.filesSkipped ?? 0).toLocaleString()} skipped，${(data.filesErrored ?? 0).toLocaleString()} errored`,
		`节点：${(data.nodesCreated ?? 0).toLocaleString()}，边：${(data.edgesCreated ?? 0).toLocaleString()}`,
		`耗时：${formatDuration(data.durationMs)}`,
	].join("\n");
}

/** 格式化 sync 结果。 */
function formatSyncSummary(result: WorkerResult): string {
	const data = (result.result?.data ?? {}) as Record<string, any>;
	const changed = data.changedCount ?? ((data.filesAdded ?? 0) + (data.filesModified ?? 0) + (data.filesRemoved ?? 0));
	if (changed === 0) return "CodeGraph 已是最新，无需同步。";
	return [
		`CodeGraph 同步完成：${changed.toLocaleString()} 个文件变动。`,
		`新增：${data.filesAdded ?? 0}，修改：${data.filesModified ?? 0}，删除：${data.filesRemoved ?? 0}`,
		`节点更新：${(data.nodesUpdated ?? 0).toLocaleString()}，耗时：${formatDuration(data.durationMs)}`,
	].join("\n");
}

/** 格式化 uninit 结果。 */
function formatUninitSummary(result: WorkerResult): string {
	const data = (result.result?.data ?? {}) as Record<string, any>;
	if (data.alreadyRemoved) return "CodeGraph 未初始化，无需删除。";
	return ["CodeGraph 索引已删除。", data.projectPath ? `项目：${data.projectPath}` : undefined].filter(Boolean).join("\n");
}

/** 格式化耗时。 */
function formatDuration(ms: number | undefined): string {
	if (!ms || ms <= 0) return "0ms";
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** 根据 worker 结果生成清晰摘要。 */
function formatWorkerSummary(command: Exclude<CodeGraphCommand, "help">, result: WorkerResult): string {
	if (result.error) {
		return [`CodeGraph ${command} 执行失败。`, result.error.message].filter(Boolean).join("\n");
	}

	switch (command) {
		case "init": return formatInitSummary(result);
		case "index": return formatIndexSummary(result);
		case "sync": return formatSyncSummary(result);
		case "status": return formatStatusSummary(result.result?.data) ?? "CodeGraph status 完成。";
		case "uninit": return formatUninitSummary(result);
	}
}

/** 处理 /codegraph 子命令。 */
async function handleCodegraphCommand(argsText: string, ctx: ExtensionCommandContext, state: RuntimeState): Promise<void> {
	const args = splitArgs(argsText);
	const subcommand = args[0] ?? "help";
	const rest = args.slice(1);

	if (subcommand === "help") {
		ctx.ui.setStatus("codegraph", "CodeGraph help");
		showHelp(ctx);
		return;
	}

	if (!CODEGRAPH_COMMANDS.includes(subcommand as CodeGraphCommand)) {
		ctx.ui.notify(`未知子命令：${subcommand}\n用法：/codegraph init|index|sync|status|uninit`, "warning");
		return;
	}

	const command = subcommand as Exclude<CodeGraphCommand, "help">;
	ctx.ui.notify(`CodeGraph ${command} 已开始...`, "info");
	ctx.ui.setStatus("codegraph", `CodeGraph ${command}: starting...`);
	const workerArgs = rest.filter((arg) => arg !== "--json" && arg !== "-j");
	const result = CUSTOM_UI_COMMANDS.has(command)
		? await runCodegraphWorkerWithCustomUi(ctx, command, workerArgs)
		: await runCodegraphWorker(ctx, command, workerArgs);
	ctx.ui.setStatus("codegraph", result.code === 0 && !result.error ? `CodeGraph ${command}: done` : `CodeGraph ${command}: failed`);

	if (command === "init" || command === "index" || command === "sync" || command === "uninit") {
		closeState(state);
		void startWatcher(state, ctx);
	}

	ctx.ui.notify(formatWorkerSummary(command, result), result.code === 0 && !result.error ? "info" : "error");
}

/** 为当前激活的 CodeGraph 工具追加使用规则。 */
function buildPrompt(systemPrompt: string, selectedTools: string[] | undefined, cwd: string): string {
	const runtime = loadCodeGraphRuntime();
	const selected = new Set(selectedTools ?? []);
	const hasCodeGraphTool = runtime.toolsModule.tools.some((tool) => selected.has(tool.name));
	if (!hasCodeGraphTool) return systemPrompt;

	const root = findProjectRoot(cwd);
	const status = root
		? `当前项目已发现 CodeGraph 索引根目录：${root}`
		: "当前项目未发现 .codegraph/。如需结构化代码检索，先询问用户是否运行 `/codegraph init` 和 `/codegraph index`。";

	return `${systemPrompt}\n\n${runtime.serverInstructions}\n\n## Pi native CodeGraph status\n\n${status}\n`;
}

export default function codegraphPiExtension(pi: ExtensionAPI): void {
	const state: RuntimeState = {};
	const runtime = loadCodeGraphRuntime();

	for (const tool of runtime.toolsModule.tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.name,
			description: tool.description,
			promptSnippet: tool.description,
			promptGuidelines: [`Use ${tool.name} only for CodeGraph structural code intelligence; prefer it over raw grep/read for matching structural questions.`],
			parameters: toTypeBoxSchema(tool),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const handler = getToolHandler(state, ctx);
				const result = await handler.execute(tool.name, params as Record<string, unknown>);
				return {
					content: result.content,
					isError: result.isError ?? false,
					details: { source: "codegraph", tool: tool.name },
				};
			},
		});
	}

	pi.registerCommand("codegraph", {
		description: "管理 CodeGraph：/codegraph init|index|sync|status|uninit|help",
		getArgumentCompletions: (prefix) => {
			const first = prefix.trim().split(/\s+/)[0] ?? "";
			return CODEGRAPH_COMMANDS.filter((command) => command.startsWith(first)).map((command) => ({ value: command, label: command }));
		},
		handler: async (args, ctx) => handleCodegraphCommand(args, ctx, state),
	});

	pi.on("session_start", (_event, ctx) => {
		void catchUpSync(state, ctx);
		void startWatcher(state, ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		return {
			systemPrompt: buildPrompt(event.systemPrompt, event.systemPromptOptions.selectedTools, ctx.cwd),
		};
	});

	pi.on("session_shutdown", () => {
		closeState(state);
	});
}
