/*
 * standard — one executor implements a task's plan in its worktree; a fresh reviewer
 * checks the diff; blocking findings go back to the same executor through resume;
 * at most two review rounds. The project's checks stay with the lead.
 * A round whose reviewer lists files outside the plan ends the run before a fix; the lead asks the engineer.
 * Parameters:
 *   args.key      — task key, e.g. "MP-116"
 *   args.plan     — absolute path of the task's plan.md
 *   args.worktree — absolute path of the task's worktree
 *   args.taskDir  — absolute path of the task's folder in mypi home
 *   args.base     — the branch the worktree was created from
 *   args.executor — role that implements (default "executor")
 *   args.reviewer — role that reviews (default "reviewer")
 * Returns { executor: { runId, report }, fixes: [{ round, ok, report }], reviews: [{ round, range, status, findings, outsidePlan }] }.
 */
const executorRole = args.executor || "executor";
const reviewerRole = args.reviewer || "reviewer";
const context = `Task ${args.key}. Plan: ${args.plan}. Worktree: ${args.worktree}. Task folder: ${args.taskDir}. Base branch: ${args.base}.`;
const implement = await runs.run("implement", {
  agent: executorRole,
  task: `${context} Implement every step of the plan in the worktree.`,
});
const report = implement.structuredOutput ?? null;
const base = report && report.base ? report.base : args.base;
let head = report && report.head ? report.head : "HEAD";
let last = implement;
const fixes = [];
const reviews = [];
for (const round of [1, 2]) {
  const review = await runs.run(`review-${round}`, {
    agent: reviewerRole,
    task: `${context} Review the diff ${base}..${head} in the worktree against the plan.`,
  });
  const verdict = review.structuredOutput ?? null;
  reviews.push({ round, range: `${base}..${head}`, status: verdict ? verdict.status : null, findings: verdict ? verdict.findings : [], outsidePlan: verdict ? verdict.outsidePlan : [] });
  if (!verdict || verdict.status !== "changes_required" || verdict.outsidePlan.length > 0 || round === 2 || !last.runId) break;
  const blocking = verdict.findings.filter((finding) => finding.severity === "blocking");
  const fix = await runs.run(`fix-${round}`, {
    resume: last.runId,
    task: `Review round ${round} returned these blocking findings: ${JSON.stringify(blocking)}. Fix them in the worktree, commit, and answer again with your whole report.`,
  });
  const fixReport = fix.structuredOutput ?? null;
  fixes.push({ round, ok: fix.ok, report: fixReport });
  head = fixReport && fixReport.head ? fixReport.head : "HEAD";
  last = fix;
}
return { executor: { runId: last.runId ?? null, report }, fixes, reviews };
