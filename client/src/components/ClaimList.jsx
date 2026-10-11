import { useState } from 'react';
import { api, REC_LABELS, STATUS_LABELS, money } from '../api.js';

export function StatusPill({ status }) {
  return <span className={`pill status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function RecPill({ rec }) {
  if (!rec) return null;
  return <span className={`pill rec-${rec}`}>{REC_LABELS[rec] || rec}</span>;
}

export default function ClaimList({ claims, loading, meta, selectedId, onSelect, statusFilter, onFilter, onReviewed, onError, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const catLabel = (k) => meta?.categories[k]?.label || (k === 'non_reimbursable' ? 'Non-reimbursable' : k) || '—';
  return (
    <section className="card list">
      <div className="list-head">
        <h2>Claims ({claims.length})</h2>
        <select value={statusFilter} onChange={(e) => onFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="row-between small">
        <button
          className="link"
          disabled={busy}
          title="Re-run the review on open claims that did not fully get AI analysis. Shift+click to re-run every open claim."
          onClick={async (e) => {
            setBusy(true);
            setNote('Re-running reviews… on the free Gemini tier this can take a few minutes.');
            try {
              const r = await api.rereviewOpen(e.shiftKey);
              setNote(
                r.reviewed === 0
                  ? `All ${r.open} open claim(s) already have AI reviews.`
                  : `Re-reviewed ${r.reviewed} claim(s); ${r.aiReviewed} now fully AI-reviewed${r.skipped ? ` (${r.skipped} already were)` : ''}.`,
              );
              onNotice?.(r.reviewed ? `Re-reviewed ${r.reviewed} claim(s).` : 'Nothing to re-review.');
              onReviewed();
            } catch (e) {
              setNote('');
              onError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Re-running…' : 'Re-run open reviews'}
        </button>
        {note && <span className="muted">{note}</span>}
      </div>
      {loading && <p className="muted">Loading claims…</p>}
      {!loading && claims.length === 0 && (
        <div className="empty-state">
          {statusFilter ? (
            <p>
              No claims with status “{STATUS_LABELS[statusFilter]}”.{' '}
              <button className="link" onClick={() => onFilter('')}>
                Show all
              </button>
            </p>
          ) : (
            <p>No claims yet. Use “Submit claims” to add one, import a CSV, or load the sample set.</p>
          )}
        </div>
      )}
      <ul className="claim-items">
        {claims.map((c) => (
          <li key={c._id} className={c._id === selectedId ? 'claim-item selected' : 'claim-item'} onClick={() => onSelect(c._id)}>
            <div className="row-between">
              <strong>{c.claimant || <em className="muted">no claimant</em>}</strong>
              <span>{c.amount ?? '—'} {c.currency}</span>
            </div>
            <div className="small muted ellipsis">{c.description || <em>no description</em>}</div>
            <div className="row-wrap">
              <StatusPill status={c.status} />
              {c.status === 'pending_review' && <RecPill rec={c.recommendation} />}
              <span className="pill pill-plain">{catLabel(c.effectiveCategory)}</span>
              {c.uncertain && <span className="pill pill-uncertain">Uncertain</span>}
              {c.overridden && <span className="pill pill-plain">Overridden</span>}
              {c.issueCount > 0 && <span className="pill pill-issues">{c.issueCount} issue{c.issueCount > 1 ? 's' : ''}</span>}
            </div>
            <div className="small muted">
              {c.date || 'no date'} · {money(c.amountUSD)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
