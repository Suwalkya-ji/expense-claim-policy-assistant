async function request(method, url, body) {
  const reviewer = localStorage.getItem('reviewer') || 'reviewer';
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Reviewer': reviewer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  meta: () => request('GET', '/meta'),
  claims: (status) => request('GET', `/claims${status ? `?status=${status}` : ''}`),
  claim: (id) => request('GET', `/claims/${id}`),
  summary: () => request('GET', '/summary'),
  samples: () => request('GET', '/samples'),
  submit: (claims) => request('POST', '/claims', { claims }),
  rereview: (id) => request('POST', `/claims/${id}/review`, {}),
  rereviewOpen: (all = false) => request('POST', `/claims/review-open${all ? '?all=true' : ''}`, {}),
  decide: (id, body) => request('POST', `/claims/${id}/decision`, body),
  override: (id, body) => request('POST', `/claims/${id}/override`, body),
  respond: (id, body) => request('POST', `/claims/${id}/clarification-response`, body),
};

export const STATUS_LABELS = {
  pending_review: 'Pending review',
  needs_clarification: 'Awaiting claimant',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const REC_LABELS = {
  comply: 'Appears compliant',
  needs_clarification: 'Needs clarification',
  needs_review: 'Needs review',
};

export const money = (n, cur = 'USD') =>
  typeof n === 'number' ? `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
