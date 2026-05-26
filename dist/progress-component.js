/**
 * 功能：渲染 /codegraph 长任务的实时进度界面
 * 实现者：alps
 * 实现日期：2026-05-26
 */
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** 把 CodeGraph 阶段名翻译成中文。 */
export function formatPhase(phase) {
    switch (phase) {
        case "scanning": return "扫描文件";
        case "parsing": return "解析代码";
        case "storing": return "写入索引";
        case "resolving": return "解析引用";
        case "creating": return "创建索引目录";
        case "clearing": return "清空旧索引";
        case "removing": return "删除索引";
        default: return phase || "处理中";
    }
}
/** 计算进度百分比。 */
export function readPercent(message) {
    if (!message || typeof message.current !== "number" || typeof message.total !== "number" || message.total <= 0)
        return undefined;
    return Math.max(0, Math.min(100, Math.floor((message.current / message.total) * 100)));
}
/** 格式化进度短文本。 */
export function formatProgress(message) {
    const phase = formatPhase(message.phase);
    if (typeof message.current === "number" && typeof message.total === "number" && message.total > 0) {
        const percent = readPercent(message) ?? 0;
        return `${phase} ${message.current.toLocaleString()}/${message.total.toLocaleString()} (${percent}%)`;
    }
    if (typeof message.current === "number")
        return `${phase} ${message.current.toLocaleString()}`;
    return message.message ?? phase;
}
/** 构造固定宽度的文本进度条。 */
function progressBar(percent, width) {
    const safeWidth = Math.max(10, width);
    if (percent === undefined)
        return "░".repeat(safeWidth);
    const filled = Math.max(0, Math.min(safeWidth, Math.round((percent / 100) * safeWidth)));
    return "█".repeat(filled) + "░".repeat(safeWidth - filled);
}
/** 格式化耗时。 */
function formatElapsed(startedAt, endedAt) {
    const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
    if (ms < 1000)
        return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
/** 在给定宽度内渲染一行。 */
function fitLine(line, width) {
    const truncated = truncateToWidth(line, width, "…");
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}
/** CodeGraph 长任务实时进度组件。 */
export class CodeGraphProgressComponent {
    tui;
    theme;
    command;
    message;
    result;
    error;
    cancelled = false;
    spinnerIndex = 0;
    startedAt = Date.now();
    endedAt;
    timer;
    onCancel;
    constructor(tui, theme, command) {
        this.tui = tui;
        this.theme = theme;
        this.command = command;
        this.timer = setInterval(() => {
            if (this.result || this.error || this.cancelled)
                return;
            this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
            this.tui.requestRender();
        }, 120);
    }
    /** 接收 worker 进度并触发重绘。 */
    update(message) {
        if (message.type === "error") {
            this.error = message.message ?? "unknown error";
            this.endedAt = Date.now();
        }
        else if (message.type === "result") {
            this.result = message;
            this.endedAt = Date.now();
        }
        else {
            this.message = message;
        }
        this.invalidate();
        this.tui.requestRender();
    }
    /** 标记为用户取消。 */
    markCancelled() {
        this.cancelled = true;
        this.endedAt = Date.now();
        this.invalidate();
        this.tui.requestRender();
    }
    /** 处理 Esc / Ctrl+C 取消。 */
    handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            this.markCancelled();
            this.onCancel?.();
        }
    }
    /** 渲染进度面板。 */
    render(width) {
        const innerWidth = Math.max(30, Math.min(width - 4, 96));
        const percent = readPercent(this.message);
        const spinner = this.result || this.error || this.cancelled ? "" : SPINNER_FRAMES[this.spinnerIndex];
        const phase = this.error ? "失败" : this.cancelled ? "已取消" : this.result ? "完成" : formatPhase(this.message?.phase);
        const statusText = this.message ? formatProgress(this.message) : "准备中";
        const file = this.message?.currentFile ?? "-";
        const title = ` CodeGraph ${this.command} ${spinner}`.trimEnd();
        const barWidth = Math.max(10, innerWidth - 12);
        const border = "─".repeat(innerWidth);
        const lines = [
            this.theme.fg("border", `╭${border}╮`),
            `│${fitLine(this.theme.fg("accent", this.theme.bold(title)), innerWidth)}│`,
            `│${fitLine(`阶段：${phase}`, innerWidth)}│`,
            `│${fitLine(`进度：${statusText}`, innerWidth)}│`,
            `│${fitLine(`${progressBar(percent, barWidth)} ${percent === undefined ? "--" : `${percent}%`}`, innerWidth)}│`,
            `│${fitLine(`当前：${file}`, innerWidth)}│`,
            `│${fitLine(`耗时：${formatElapsed(this.startedAt, this.endedAt)}`, innerWidth)}│`,
            `│${fitLine(this.error ? `错误：${this.error}` : this.cancelled ? "已取消" : "Esc / Ctrl+C 取消", innerWidth)}│`,
            this.theme.fg("border", `╰${border}╯`),
        ];
        return lines;
    }
    /** 清理缓存；当前组件无缓存。 */
    invalidate() {
        // 当前渲染完全由最新状态计算，无需清缓存。
    }
    /** 释放动画计时器。 */
    dispose() {
        clearInterval(this.timer);
    }
}
//# sourceMappingURL=progress-component.js.map