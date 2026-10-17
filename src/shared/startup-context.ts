// Pi-independent formatting of the ordinary CLI warmup response.
export interface StartupMemory { path: string; text: string }
export interface StartupWarmup { memory: StartupMemory[]; [field: string]: unknown }

export function startupSections(response: StartupWarmup): { memory: string; context: string } {
  if (!Array.isArray(response.memory) || response.memory.some(item => !item || typeof item.path !== 'string' || typeof item.text !== 'string')) {
    throw new Error('Invalid warmup memory response');
  }
  const size = response.memory.reduce((total, item) => total + Buffer.byteLength(item.text, 'utf8'), 0);
  const memory = size > 32 * 1024
    ? 'Memory exceeds the 32 KiB autoload limit; no memory was loaded. Use scoped memory show for full content.'
    : response.memory.filter(item => item.text).map(item => `Source: ${item.path}\n${item.text}`).join('\n\n');
  const { memory: _memory, ...remaining } = response;
  return { memory, context: JSON.stringify(remaining) };
}
