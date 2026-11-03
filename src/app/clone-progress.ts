export const PROGRESS_INTERVAL_MS = 250;
export const PROGRESS_REPEAT_MS = 10_000;

export function throttleProgress(emit: (line: string) => void, now: () => number = Date.now): (line: string) => void {
  let last: { line: string; at: number } | undefined;
  return line => {
    const at = now();
    if (last && !(line !== last.line && at - last.at >= PROGRESS_INTERVAL_MS) && at - last.at < PROGRESS_REPEAT_MS) return;
    last = { line, at };
    emit(line);
  };
}
