/** What VS Code gives a webview's script. It can be acquired once per page. */
interface VsCodeApi<State> {
  postMessage(message: unknown): void
  /** State VS Code keeps for this webview while its page is discarded and rebuilt. */
  getState(): State | undefined
  setState(state: State): void
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>
