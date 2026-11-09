/*
 * parallel — several parts at once, one worktree per part; each part runs the chain of
 * standard.js: its executor implements, a fresh reviewer checks the diff, blocking
 * findings go back to the same executor through resume, at most two review rounds.
 * The project's checks stay with the lead.
 * Parameters:
 *   args.parts    — [{ key, agent, plan, worktree, taskDir, base }]: key — a short unique
 *                   part name (letters, digits, "-"), agent — role that implements
 *                   (default "executor"), plan, worktree, taskDir — absolute paths,
 *                   base — the branch the part's worktree was created from
 *   args.reviewer — role that reviews (default "reviewer")
 * Returns [{ key, executor: { runId, report }, fixes, reviews }] in the order of args.parts.
 */
const reviewerRole = args.reviewer || "reviewer";
async function chain(part) {
  const context = `Part ${part.key}. Plan: ${part.plan}. Worktree: ${part.worktree}. Task folder: ${part.taskDir}. Base branch: ${part.base}.`;
  const implement = await runs.run(`${part.key}-implement`, {
    agent: part.agent || "executor",
    task: `${context} Implement every step of the plan in the worktree.`,
  });
  const report = implement.structuredOutput ?? null;
  const base = report && report.base ? report.base : part.base;
  let head = report && report.head ? report.head : "HEAD";
  let last = implement;
  const fixes = [];
  const reviews = [];
  for (const round of [1, 2]) {
    const review = await runs.run(`${part.key}-review-${round}`, {
      agent: reviewerRole,
      task: `${context} Review the diff ${base}..${head} in the worktree against the plan.`,
    });
    const verdict = review.structuredOutput ?? null;
    reviews.push({ round, status: verdict ? verdict.status : null, findings: verdict ? verdict.findings : [] });
    if (!verdict || verdict.status !== "changes_required" || round === 2 || !last.runId) break;
    const blocking = verdict.findings.filter((finding) => finding.severity === "blocking");
    const fix = await runs.run(`${part.key}-fix-${round}`, {
      resume: last.runId,
      task: `Review round ${round} returned these blocking findings: ${JSON.stringify(blocking)}. Fix them in the worktree, commit, and answer again with your whole report.`,
    });
    const fixReport = fix.structuredOutput ?? null;
    fixes.push({ round, ok: fix.ok, report: fixReport });
    head = fixReport && fixReport.head ? fixReport.head : "HEAD";
    last = fix;
  }
  return { key: part.key, executor: { runId: last.runId ?? null, report }, fixes, reviews };
}
return await Promise.all(args.parts.map(chain));
