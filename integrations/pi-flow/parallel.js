/*
 * parallel — several parts at once, one worktree per part; each part runs the chain of
 * standard.js: its executor implements, a fresh reviewer checks the diff, blocking
 * findings go back to the same executor through resume, at most two review rounds.
 * The project's checks stay with the lead.
 * A round whose reviewer lists files outside the plan ends the run before a fix; the lead asks the engineer.
 * Parameters:
 *   args.parts    — [{ key, agent, plan, worktree, taskDir, base }]: key — a short unique
 *                   part name (letters, digits, "-"), agent — role that implements
 *                   (default "executor"), plan, worktree, taskDir — absolute paths,
 *                   base — the branch the part's worktree was created from
 *   args.reviewer — role that reviews (default "reviewer")
 * Returns [{ key, executor: { runId, report }, fixes, reviews: [{ round, range, status, findings, outsidePlan }] }] in the order of args.parts.
 */
const reviewerRole = args.reviewer || "reviewer";
function rounds(part, context, state, round) {
  return runs
    .run(`${part.key}-review-${round}`, {
      agent: reviewerRole,
      task: `${context} Review the diff ${state.base}..${state.head} in the worktree against the plan.`,
    })
    .then((review) => {
      const verdict = review.structuredOutput ?? null;
      state.reviews.push({ round, range: `${state.base}..${state.head}`, status: verdict ? verdict.status : null, findings: verdict ? verdict.findings : [], outsidePlan: verdict ? verdict.outsidePlan || [] : [] });
      if (!verdict || verdict.status !== "changes_required" || (verdict.outsidePlan || []).length > 0 || round === 2 || !state.last.runId) return state;
      const blocking = verdict.findings.filter((finding) => finding.severity === "blocking");
      return runs
        .run(`${part.key}-fix-${round}`, {
          resume: state.last.runId,
          task: `Review round ${round} returned these blocking findings: ${JSON.stringify(blocking)}. Fix them in the worktree, commit, and answer again with your whole report.`,
        })
        .then((fix) => {
          const fixReport = fix.structuredOutput ?? null;
          state.fixes.push({ round, ok: fix.ok, report: fixReport });
          state.head = fixReport && fixReport.head ? fixReport.head : "HEAD";
          state.last = fix;
          return rounds(part, context, state, round + 1);
        });
    });
}
function chain(part) {
  const context = `Part ${part.key}. Plan: ${part.plan}. Worktree: ${part.worktree}. Task folder: ${part.taskDir}. Base branch: ${part.base}.`;
  return runs
    .run(`${part.key}-implement`, {
      agent: part.agent || "executor",
      task: `${context} Implement every step of the plan in the worktree.`,
    })
    .then((implement) => {
      const report = implement.structuredOutput ?? null;
      const state = {
        report,
        base: report && report.base ? report.base : part.base,
        head: report && report.head ? report.head : "HEAD",
        last: implement,
        fixes: [],
        reviews: [],
      };
      return rounds(part, context, state, 1);
    })
    .then((state) => ({ key: part.key, executor: { runId: state.last.runId ?? null, report: state.report }, fixes: state.fixes, reviews: state.reviews }));
}
return await Promise.all(args.parts.map(chain));
