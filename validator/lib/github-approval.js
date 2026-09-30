// Exact-head owner approval from GitHub, for the opt-in agent-operated integration gate.
// Caller supplies repository, owner and target branch from the protected baseline, never from the evidence file.
import { githubGet } from './delivery-check.js';
import { WfError } from './records.js';
export function readOwnerApproval({ repository, pullRequest, revision, baseline, branch, approver, worker, get = githubGet }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || repository.split('/').some(s => ['.', '..'].includes(s))) throw new WfError('owner approval requires the baseline repository identity');
  if (!/^[1-9][0-9]{0,9}$/.test(String(pullRequest ?? ''))) throw new WfError('invalid pull request number');
  if (![revision, baseline].every(s => /^[0-9a-f]{40,64}$/.test(s ?? ''))) throw new WfError('owner approval requires exact candidate and baseline SHAs');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(approver ?? '') || !worker || approver.toLowerCase() === worker.toLowerCase()) throw new WfError('baseline owner and worker identities must be distinct');
  if (typeof branch !== 'string' || !branch.trim()) throw new WfError('owner approval requires the baseline trusted branch');
  const endpoint = `repos/${repository}/pulls/${pullRequest}`;
  const pr = get(endpoint);
  const matches = p => p.number === Number(pullRequest) && p.state === 'open' && p.draft === false && p.head?.sha === revision && p.base?.sha === baseline && p.base?.ref === branch && p.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase() && p.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase();
  const result = { approved: false, candidate_matches: false, repository, pull_request: Number(pullRequest), revision, baseline, approver, review: null, reason: null };
  if (!matches(pr)) return { ...result, reason: 'pull request is not an open ready candidate at the specified head, baseline, branch and repository (forks are not supported)' };
  if (!Number.isFinite(Date.parse(pr.updated_at))) throw new WfError('GitHub pull request update time is missing');
  result.candidate_matches = true;
  const reviews = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw new WfError('owner review history exceeds the bounded collector');
    const values = get(`${endpoint}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(values) || values.length > 100) throw new WfError('incomplete GitHub review response');
    reviews.push(...values);
    if (values.length < 100) break;
  }
  if (reviews.some(r => !Number.isSafeInteger(r.id)) || new Set(reviews.map(r => r.id)).size !== reviews.length) throw new WfError('invalid or duplicate GitHub review identities');
  const decisions = reviews.filter(r => r.user?.login?.toLowerCase() === approver.toLowerCase() && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)).sort((a, b) => b.id - a.id);
  const review = decisions[0];
  if (!review || review.state !== 'APPROVED' || review.commit_id !== revision || !review.submitted_at) result.reason = 'owner approval is missing, stale, dismissed or superseded by a change request';
  else {
    const current = get(endpoint);
    if (!matches(current) || current.updated_at !== pr.updated_at) result.reason = 'pull request changed during approval collection; collect a fresh snapshot';
    else {
      result.approved = true;
      result.review = { id: review.id, reviewer: approver, revision, submitted_at: review.submitted_at, url: `https://github.com/${repository}/pull/${pullRequest}#pullrequestreview-${review.id}` };
    }
  }
  return result;
}

export const DELIVERY_MARKER = '<!-- agent-workflow:delivery-evidence@1 -->';
// The latest marked worker comment is data, never an approval. A stale/invalid new report cannot fall back
// to an older green report. The evaluator still binds every stage and task to the candidate SHA.
export function readDeliveryEvidence({ repository, pullRequest, worker, get = githubGet }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || repository.split('/').some(s => ['.', '..'].includes(s)) || !/^[1-9][0-9]{0,9}$/.test(String(pullRequest ?? '')) || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(worker ?? '')) throw new WfError('delivery evidence requires baseline repository/worker identity and a PR number');
  const comments = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw new WfError('delivery comment history exceeds the bounded collector');
    const values = get(`repos/${repository}/issues/${pullRequest}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(values) || values.length > 100) throw new WfError('incomplete GitHub comment response');
    comments.push(...values);
    if (values.length < 100) break;
  }
  if (comments.some(c => !Number.isSafeInteger(c.id)) || new Set(comments.map(c => c.id)).size !== comments.length) throw new WfError('invalid or duplicate GitHub comment identities');
  const marked = comments.filter(c => c.user?.login?.toLowerCase() === worker.toLowerCase() && typeof c.body === 'string' && c.body.startsWith(DELIVERY_MARKER)).sort((a, b) => b.id - a.id);
  if (!marked.length) return { evidence: null, source: null };
  const comment = marked[0];
  if (Buffer.byteLength(comment.body, 'utf8') > 128 * 1024) throw new WfError('delivery evidence comment is too large');
  let evidence;
  try { evidence = JSON.parse(comment.body.slice(DELIVERY_MARKER.length).trim()); } catch { throw new WfError('the latest marked worker delivery comment is not valid JSON'); }
  return { evidence, source: `https://github.com/${repository}/pull/${pullRequest}#issuecomment-${comment.id}` };
}
