/**
 * 功能：定位并加载 CodeGraph 平台包里的运行时代码
 * 实现者：alps
 * 实现日期：2026-05-26
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
let cachedRuntime;
/** 根据当前 Node 平台名解析 CodeGraph 的平台包名。 */
function getPlatformPackageName() {
    return `@colbymchenry/codegraph-${process.platform}-${process.arch}`;
}
/** 构造内置 CLI 启动信息，Windows 下直接使用随包 node.exe。 */
function buildCliLauncher(platformPackageName, platformPackageRoot) {
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
function readCodeGraphClass(mod) {
    const codegraphClass = mod.default ?? mod.CodeGraph;
    if (!codegraphClass) {
        throw new Error("CodeGraph runtime does not export CodeGraph class");
    }
    return codegraphClass;
}
/** 加载 CodeGraph 核心、MCP 工具实现和提示词。 */
export function loadCodeGraphRuntime() {
    if (cachedRuntime)
        return cachedRuntime;
    const platformPackageName = getPlatformPackageName();
    const platformPackageJson = require.resolve(`${platformPackageName}/package.json`);
    const platformPackageRoot = dirname(platformPackageJson);
    const codegraph = require(`${platformPackageName}/lib/dist/index.js`);
    const toolsModule = require(`${platformPackageName}/lib/dist/mcp/tools.js`);
    const instructionsModule = require(`${platformPackageName}/lib/dist/mcp/server-instructions.js`);
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
//# sourceMappingURL=codegraph-runtime.js.map