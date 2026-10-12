import { mkdirSync, openSync, readSync, fstatSync, closeSync, constants, lstatSync, realpathSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

/** A private single-launch directory; never reuse an existing token or card path. */
export function preparePiExitMarker(sessionDirectory: string, token: string): string {
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error('Invalid launch token');
  const root = join(sessionDirectory, 'launches');
  mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  const parent = lstatSync(sessionDirectory);
  if (!parent.isDirectory() || realpathSync(sessionDirectory) !== sessionDirectory
    || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0)
    throw new Error('Unsafe launch session directory');
  try { mkdirSync(root, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = lstatSync(root);
  if (!stat.isDirectory() || realpathSync(root) !== root
    || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    throw new Error('Unsafe launch diagnostic directory');
  const directory = join(root, token);
  mkdirSync(directory, { mode: 0o700 });
  return join(directory, 'exit');
}

/** Unknown includes a missing, malformed or unsafe marker. No symlink traversal. */
export function readPiExitMarker(path: string): number | 'unavailable' | undefined {
  try {
    const directory = dirname(path), root = dirname(directory), sessionDirectory = dirname(root);
    if (basename(path) !== 'exit' || basename(root) !== 'launches'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(basename(directory))) return 'unavailable';
    for (const current of [sessionDirectory, root, directory]) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0
        || realpathSync(current) !== current) return 'unavailable';
    }
  } catch { return 'unavailable'; }
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : 'unavailable'; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 7 || stat.size > 10) return 'unavailable';
    const buffer = Buffer.alloc(11);
    if (readSync(fd, buffer, 0, 11, 0) !== stat.size) return 'unavailable';
    if (buffer.subarray(0, stat.size).some(byte => byte > 0x7f)) return 'unavailable';
    const text = buffer.subarray(0, stat.size).toString('ascii');
    if (!/^exit:(?:0|[1-9][0-9]{0,2})\n$/.test(text)) return 'unavailable';
    const code = Number(text.slice(5));
    return code <= 255 ? code : 'unavailable';
  } catch { return 'unavailable'; }
  finally { closeSync(fd); }
}
