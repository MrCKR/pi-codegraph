/**
 * 功能：定位并加载 CodeGraph 平台包里的运行时代码
 * 实现者：alps
 * 实现日期：2026-05-26
 */
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
    getChangedFiles?(): {
        added?: string[];
        modified?: string[];
        removed?: string[];
    };
    getBackend?(): string;
    getJournalMode?(): string;
    sync(options?: {
        onProgress?: (progress: Record<string, any>) => void;
    }): Promise<CodeGraphSyncResult>;
    indexAll(options?: {
        onProgress?: (progress: Record<string, any>) => void;
    }): Promise<Record<string, any>>;
    watch(options?: CodeGraphWatchOptions): boolean;
}
export interface CodeGraphClass {
    init(projectRoot: string, options?: {
        index?: boolean;
    }): Promise<CodeGraphInstance>;
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
    content: Array<{
        type: "text";
        text: string;
    }>;
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
/** 加载 CodeGraph 核心、MCP 工具实现和提示词。 */
export declare function loadCodeGraphRuntime(): LoadedCodeGraphRuntime;
export {};
