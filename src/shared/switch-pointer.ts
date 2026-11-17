export const POINTER_PREFIX = '[mypi: с вашего прошлого хода в ';

export function pointerLine(input: { key: string; agent: string; device: string; entries: number; commits: number | 'pull' | null }): string {
  const tail = input.commits === 'pull' ? ', сначала git pull' : input.commits === null ? '' : ', ' + input.commits + ' коммитов в ветке';
  const line = (device: string) => POINTER_PREFIX + input.key + ' работала сессия ' + input.agent + ' на ' + device + ': '
    + input.entries + ' записей журнала' + tail + '; подробнее — journal ' + input.key + ']';
  const full = line(input.device);
  const length = [...full].length;
  if (length <= 200) return full;
  const device = [...input.device];
  const keep = device.length - (length - 200) - 1;
  if (keep < 1) return '';
  return line(device.slice(0, keep).join('') + '…');
}

export function stripPointer(text: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex(line => line.startsWith(POINTER_PREFIX) && line.endsWith(']'));
  if (at === -1) return text;
  lines.splice(at, 1);
  if (lines[at] === '') lines.splice(at, 1);
  else if (at > 0 && lines[at - 1] === '') lines.splice(at - 1, 1);
  return lines.join('\n');
}
