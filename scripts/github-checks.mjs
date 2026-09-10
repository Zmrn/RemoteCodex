// Read-only gate shared by the conversational dispatcher and hosted build.
export async function requireSuccessfulChecks(get, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw Error('A full commit SHA is required');
  const response = await get(`actions/workflows/ci.yml/runs?branch=main&head_sha=${commit}&per_page=100`);
  if (!Array.isArray(response?.workflow_runs)) throw Error('Checks response unavailable; no build may start');
  const runs = response.workflow_runs.filter(run => run.head_sha === commit && run.head_branch === 'main' &&
    run.path === '.github/workflows/ci.yml' && ['push', 'workflow_dispatch'].includes(run.event));
  runs.sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0) || b.id - a.id);
  const run = runs[0];
  if (!run) throw Error(`No main Checks run for ${commit}; push this commit and wait for Checks before building`);
  if (run.status !== 'completed' || run.conclusion !== 'success')
    throw Error(`Checks ${run.id} for ${commit} is ${run.status}/${run.conclusion ?? 'pending'}; build blocked. Use status/watch ${run.id}; fix failures before dispatching`);
  return { commit, checksRunId: run.id, checksUrl: run.html_url, checksPassed: true };
}
