/**
 * 功能：渲染 /codegraph 长任务的实时进度界面
 * 实现者：alps
 * 实现日期：2026-05-26
 */
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
export type ProgressCommand = "init" | "sync" | "status" | "uninit";
export interface ProgressMessage {
    type: "start" | "progress" | "result" | "error";
    command: ProgressCommand;
    message?: string;
    phase?: string;
    current?: number;
    total?: number;
    currentFile?: string;
    data?: unknown;
}
/** 把 CodeGraph 阶段名翻译成中文。 */
export declare function formatPhase(phase: string | undefined): string;
/** 计算进度百分比。 */
export declare function readPercent(message: ProgressMessage | undefined): number | undefined;
/** 格式化进度短文本。 */
export declare function formatProgress(message: ProgressMessage): string;
/** CodeGraph 长任务实时进度组件。 */
export declare class CodeGraphProgressComponent implements Component {
    private readonly tui;
    private readonly theme;
    private readonly command;
    private message?;
    private result?;
    private error?;
    private cancelled;
    private spinnerIndex;
    private readonly startedAt;
    private endedAt?;
    private timer;
    onCancel?: () => void;
    constructor(tui: Pick<TUI, "requestRender">, theme: Theme, command: ProgressCommand);
    /** 接收 worker 进度并触发重绘。 */
    update(message: ProgressMessage): void;
    /** 标记为用户取消。 */
    markCancelled(): void;
    /** 处理 Esc / Ctrl+C 取消。 */
    handleInput(data: string): void;
    /** 渲染进度面板。 */
    render(width: number): string[];
    /** 清理缓存；当前组件无缓存。 */
    invalidate(): void;
    /** 释放动画计时器。 */
    dispose(): void;
}
