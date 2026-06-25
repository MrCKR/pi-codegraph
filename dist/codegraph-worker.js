/**
 * 功能：在独立进程中执行 CodeGraph 写索引命令并输出 JSON Lines 进度
 * 实现者：alps
 * 实现日期：2026-05-26
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadCodeGraphRuntime } from "./codegraph-runtime.js";
/** 输出一行 JSON，供 pi 扩展解析。 */
function emit(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
/** 失败时输出结构化错误并设置退出码。 */
function fail(command, error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", command, message });
    process.exit(1);
}
/** 计算文件变动总数。 */
function changedCount(result) {
    return result.filesAdded + result.filesModified + result.filesRemoved;
}
/** 读取当前索引状态。 */
function readStatus(projectPath) {
    const runtime = loadCodeGraphRuntime();
    if (!runtime.codegraphClass)
        throw new Error("CodeGraph runtime is not loaded");
    const initialized = runtime.codegraph.findNearestCodeGraphRoot(projectPath) !== null;
    if (!initialized) {
        return { initialized: false, projectPath };
    }
    const root = runtime.codegraph.findNearestCodeGraphRoot(projectPath) ?? projectPath;
    const cg = runtime.codegraphClass.openSync(root);
    try {
        const stats = cg.getStats?.() ?? {};
        const changes = cg.getChangedFiles?.() ?? { added: [], modified: [], removed: [] };
        return {
            initialized: true,
            projectPath: root,
            fileCount: stats.fileCount,
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
            dbSizeBytes: stats.dbSizeBytes,
            backend: cg.getBackend?.(),
            journalMode: cg.getJournalMode?.(),
            nodesByKind: stats.nodesByKind,
            languages: Object.entries(stats.filesByLanguage ?? {}).filter(([, count]) => Number(count) > 0).map(([lang]) => lang),
            pendingChanges: {
                added: changes.added?.length ?? 0,
                modified: changes.modified?.length ?? 0,
                removed: changes.removed?.length ?? 0,
            },
        };
    }
    finally {
        cg.close();
    }
}
/** 确保项目已初始化，然后全量建立索引。 */
async function runInit(projectPath, force) {
    const runtime = loadCodeGraphRuntime();
    const root = runtime.codegraph.findNearestCodeGraphRoot(projectPath);
    const projectRoot = root ?? projectPath;
    emit({ type: "start", command: "init", message: root ? "opening project" : "initializing project", data: { projectPath: projectRoot, initialized: Boolean(root) } });
    const cg = root ? await runtime.codegraphClass.open(root) : await runtime.codegraphClass.init(projectPath, { index: false });
    try {
        if (!root) {
            emit({ type: "progress", command: "init", phase: "creating", current: 1, total: 1 });
        }
        if (force && root) {
            emit({ type: "progress", command: "init", phase: "clearing", current: 0, total: 1 });
            cg.clear();
        }
        const result = await cg.indexAll({
            onProgress: (progress) => emit({ type: "progress", command: "init", ...progress }),
        });
        emit({ type: "result", command: "init", message: result.success ? "indexed" : "index failed", data: { ...result, projectPath: projectRoot, initialized: !root } });
        if (!result.success)
            process.exitCode = 1;
    }
    finally {
        cg.close();
    }
}
/** 增量同步代码变动。 */
async function runSync(projectPath) {
    const runtime = loadCodeGraphRuntime();
    const root = runtime.codegraph.findNearestCodeGraphRoot(projectPath);
    if (!root)
        throw new Error("CodeGraph is not initialized. Run /codegraph init first.");
    emit({ type: "start", command: "sync", message: "checking changes", data: { projectPath: root } });
    const cg = await runtime.codegraphClass.open(root);
    try {
        const result = await cg.sync({
            onProgress: (progress) => emit({ type: "progress", command: "sync", ...progress }),
        });
        emit({ type: "result", command: "sync", message: "synced", data: { ...result, changedCount: changedCount(result) } });
    }
    finally {
        cg.close();
    }
}
/** 删除 .codegraph 目录。 */
function runUninit(projectPath) {
    const runtime = loadCodeGraphRuntime();
    const root = runtime.codegraph.findNearestCodeGraphRoot(projectPath);
    emit({ type: "start", command: "uninit", message: "checking project" });
    if (!root) {
        emit({ type: "result", command: "uninit", message: "not initialized", data: { projectPath, alreadyRemoved: true } });
        return;
    }
    emit({ type: "progress", command: "uninit", phase: "removing", current: 0, total: 1 });
    rmSync(resolve(root, ".codegraph"), { recursive: true, force: true });
    emit({ type: "result", command: "uninit", message: "removed", data: { projectPath: root } });
}
/** worker 入口。 */
async function main() {
    const [, , commandArg, projectArg, ...flags] = process.argv;
    const command = commandArg;
    const projectPath = resolve(projectArg || process.cwd());
    if (!command || !["init", "sync", "status", "uninit"].includes(command)) {
        throw new Error("Usage: codegraph-worker <init|sync|status|uninit> <projectPath> [--force]");
    }
    switch (command) {
        case "init":
            await runInit(projectPath, flags.includes("--force"));
            break;
        case "sync":
            await runSync(projectPath);
            break;
        case "status":
            emit({ type: "start", command, message: "checking status" });
            emit({ type: "result", command, message: "status", data: readStatus(projectPath) });
            break;
        case "uninit":
            runUninit(projectPath);
            break;
    }
}
main().catch((error) => fail(process.argv[2] ?? "status", error));
//# sourceMappingURL=codegraph-worker.js.map