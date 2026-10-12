export function viewportWidth(columns: number): number { return Math.max(10, columns - 40); }
export function viewportStep(columns: number): number { return Math.max(1, Math.floor(viewportWidth(columns) / 2)); }
export function shiftViewport(offset: number, direction: -1 | 1, columns: number): number {
  return Math.max(0, offset + direction * viewportStep(columns));
}
export function visibleSegment(text: string, offset: number, columns: number): string {
  return text.slice(offset, offset + viewportWidth(columns));
}
