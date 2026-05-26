/**
 * 功能：定位并加载 CodeGraph 平台包里的运行时代码
 * 实现者：alps
 * 实现日期：2026-05-26
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export interface CodeGraphSyncResult {
	filesAdded: number;
	filesModified: number;
	filesRemoved: number;
}

export interface CodeGraphWatchResult {
	filesChanged: number;
	durationMs: number;
}

export interface CodeGraphWatchOptions {
	onSyncComplete?: (result: CodeGraphWatchResult) => void;
	onSyncError?: (error: Error) => void;
}

export interface CodeGraphInstance {
	close(): void;
	clear(): void;
	getStats?(): Record<string, any>;
	getChangedFiles?(): { added?: string[]; modified?: string[]; removed?: string[] };
	getBackend?(): string;
	getJournalMode?(): string;
	sync(options?: { onProgress?: (progress: Record<string, any>) => void }): Promise<CodeGraphSyncResult>;
	indexAll(options?: { onProgress?: (progress: Record<string, any>) => void }): Promise<Record<string, any>>;
	watch(options?: CodeGraphWatchOptions): boolean;
}

export interface CodeGraphClass {
	init(projectRoot: string, options?: { index?: boolean }): Promise<CodeGraphInstance>;
	open(projectRoot: string): Promise<CodeGraphInstance>;
	openSync(projectRoot: string): CodeGraphInstance;
}

export interface CodeGraphModule {
	findNearestCodeGraphRoot(startPath: string): string | null;
	default?: CodeGraphClass;
	CodeGraph?: CodeGraphClass;
}

interface PropertySchema {
	type: string;
	description: string;
	enum?: string[];
	default?: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, PropertySchema>;
		required?: string[];
	};
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

export interface ToolHandler {
	execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
	setDefaultProjectHint(searchedPath: string): void;
	closeAll(): void;
}

export interface ToolHandlerConstructor {
	new (cg: CodeGraphInstance | null): ToolHandler;
}

export interface ToolsModule {
	tools: ToolDefinition[];
	ToolHandler: ToolHandlerConstructor;
}

export interface LoadedCodeGraphRuntime {
	codegraph: CodeGraphModule;
	codegraphClass: CodeGraphClass;
	toolsModule: ToolsModule;
	serverInstructions: string;
	platformPackageName: string;
	platformPackageRoot: string;
	cliCommand: string;
	cliArgsPrefix: string[];
	workerCommand: string;
	workerArgsPrefix: string[];
}

let cachedRuntime: LoadedCodeGraphRuntime | undefined;

/** 根据当前 Node 平台名解析 CodeGraph 的平台包名。 */
function getPlatformPackageName(): string {
	return `@colbymchenry/codegraph-${process.platform}-${process.arch}`;
}

/** 构造内置 CLI 启动信息，Windows 下直接使用随包 node.exe。 */
function buildCliLauncher(platformPackageName: string, platformPackageRoot: string): { command: string; argsPrefix: string[] } {
	if (process.platform === "win32") {
		return {
			command: join(platformPackageRoot, "node.exe"),
			argsPrefix: ["--liftoff-only", join(platformPackageRoot, "lib", "dist", "bin", "codegraph.js")],
		};
	}

	return {
		command: require.resolve(`${platformPackageName}/bin/codegraph`),
		argsPrefix: [],
	};
}

/** 取 CodeGraph class，兼容 CommonJS 转译后的 default 和命名导出。 */
function readCodeGraphClass(mod: CodeGraphModule): CodeGraphClass {
	const codegraphClass = mod.default ?? mod.CodeGraph;
	if (!codegraphClass) {
		throw new Error("CodeGraph runtime does not export CodeGraph class");
	}
	return codegraphClass;
}

/** 加载 CodeGraph 核心、MCP 工具实现和提示词。 */
export function loadCodeGraphRuntime(): LoadedCodeGraphRuntime {
	if (cachedRuntime) return cachedRuntime;

	const platformPackageName = getPlatformPackageName();
	const platformPackageJson = require.resolve(`${platformPackageName}/package.json`);
	const platformPackageRoot = dirname(platformPackageJson);
	const codegraph = require(`${platformPackageName}/lib/dist/index.js`) as CodeGraphModule;
	const toolsModule = require(`${platformPackageName}/lib/dist/mcp/tools.js`) as ToolsModule;
	const instructionsModule = require(`${platformPackageName}/lib/dist/mcp/server-instructions.js`) as { SERVER_INSTRUCTIONS: string };
	const cli = buildCliLauncher(platformPackageName, platformPackageRoot);

	cachedRuntime = {
		codegraph,
		codegraphClass: readCodeGraphClass(codegraph),
		toolsModule,
		serverInstructions: instructionsModule.SERVER_INSTRUCTIONS,
		platformPackageName,
		platformPackageRoot,
		cliCommand: cli.command,
		cliArgsPrefix: cli.argsPrefix,
		workerCommand: process.execPath,
		workerArgsPrefix: ["--liftoff-only", fileURLToPath(new URL("./codegraph-worker.js", import.meta.url))],
	};

	return cachedRuntime;
}
