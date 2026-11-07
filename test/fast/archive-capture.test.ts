import test from 'node:test';
import assert from 'node:assert/strict';
import { captureInput } from '../../src/app/session-input.js';

const stop = { session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/work', permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: false };
const end = (reason: string) => ({ session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/work', hook_event_name: 'SessionEnd', reason });

test('capture hook input takes the native id and transcript of Stop and SessionEnd', () => {
  const expected = { nativeId: 'c1', transcript: '/tmp/t.jsonl' };
  assert.deepEqual(captureInput(JSON.stringify(stop)), expected);
  assert.deepEqual(captureInput(JSON.stringify({ ...stop, stop_hook_active: true })), expected);
  assert.deepEqual(captureInput(JSON.stringify({ ...stop, last_assistant_message: 'synthetic answer' })), expected);
  for (const reason of ['clear', 'logout', 'prompt_input_exit', 'other']) assert.deepEqual(captureInput(JSON.stringify(end(reason))), expected);
  for (const transcript_path of [undefined, '', 7]) assert.deepEqual(captureInput(JSON.stringify({ ...stop, transcript_path })), { nativeId: 'c1' });
  const { hook_event_name: _, ...unnamed } = stop;
  const { session_id: __, ...anonymous } = stop;
  for (const text of ['{', '[]', 'null', JSON.stringify({ ...stop, hook_event_name: 'Notification' }), JSON.stringify({ ...stop, hook_event_name: 'SessionStart' }),
    JSON.stringify(unnamed), JSON.stringify({ ...stop, session_id: '' }), JSON.stringify(anonymous)])
    assert.throws(() => captureInput(text), /Invalid Stop or SessionEnd hook input/);
});
