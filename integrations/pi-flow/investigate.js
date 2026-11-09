/*
 * investigate — read-only fan-out: a scout per task or an investigator per question,
 * all at once; nothing is written.
 * Parameters:
 *   args.items — [{ key, agent, task }]: key — a short unique name (letters, digits, "-"),
 *                agent — a read-only role, "scout" for a task or "investigator" for a
 *                question (default "investigator"), task — the full task text
 * Returns [{ key, agent, ok, answer }] in the order of args.items; answer is the role's
 * structured output or null.
 */
const results = await runs.all(
  args.items.map((item) => ({ key: item.key, agent: item.agent || "investigator", task: item.task })),
);
return results.map((result, index) => ({
  key: args.items[index].key,
  agent: args.items[index].agent || "investigator",
  ok: result.ok,
  answer: result.structuredOutput ?? null,
}));
