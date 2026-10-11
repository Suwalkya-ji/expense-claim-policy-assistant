import { useEffect, useState } from 'react';
import { api, money, REC_LABELS } from '../api.js';
import { RecPill, StatusPill } from './ClaimList.jsx';

const SEVERITY_ICON = { error: '✖', warning: '▲', info: 'ℹ' };
const ASSESSMENT_LABEL = { supports: 'Supports', concern: 'Concern', violation: 'Violation' };
const HISTORY_LABEL = {
  submitted: 'Submitted',
  ai_review: 'Automated review',
  decision: 'Reviewer decision',
  override: 'Category override',
  clarification_response: 'Claimant responded',
};

const fmtTime = (d) => (d ? new Date(d).toLocaleString() : '');

function Section({ title, children, right }) {
  return (
    <section className="detail-section">
      <div className="row-between">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function CitationList({ citations, sections, onShow }) {
  if (!citations?.length) return <div className="small warn-text">No policy citation provided.</div>;
  return (
    <ul className="citations">
      {citations.map((c, i) => (
        <li key={i} className={c.verified ? 'cite ok' : 'cite bad'}>
          <button className="link" onClick={() => onShow(c.sectionId)} disabled={!sections.some((s) => s.id === c.sectionId)}>
            [{c.sectionId}] {c.heading || ''}
          </button>{' '}
          <q>{c.quote}</q>{' '}
          <span className="small">{c.verified ? '✓ quote verified in policy' : '⚠ quote not found in the retrieved policy text'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ClaimDetail({ id, meta, onChanged, onError, onNotice }) {
  const [claim, setClaim] = useState(null);
  const [busy, setBusy] = useState(''); // label of the running action, '' when idle
  const [loadError, setLoadError] = useState('');
  const [shownSection, setShownSection] = useState(null);
  const [note, setNote] = useState('');
  const [questions, setQuestions] = useState([]);
  const [override, setOverride] = useState({ category: '', reason: '' });
  const [response, setResponse] = useState({ text: '', receipt: '', category: '', description: '' });
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    api
      .claim(id)
      .then((c) => {
        setClaim(c);
        setQuestions(c.review?.questions || []);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  /** Run a reviewer action: shows `label` while running, then a success notice or the error. */
  const act = async (label, success, fn) => {
    setBusy(label);
    try {
      const updated = await fn();
      setClaim(updated);
      setQuestions(updated.review?.questions || []);
      setNote('');
      onChanged();
      onNotice?.(typeof success === 'function' ? success(updated) : success);
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    } finally {
      setBusy('');
    }
  };

  if (loadError) return <div className="card empty alert-error">Could not load this claim: {loadError}</div>;
  if (!claim) return <div className="card empty">Loading claim…</div>;
  const r = claim.review || {};
  const cls = r.classification || {};
  const sections = r.retrievedSections || [];
  const final = ['approved', 'rejected'].includes(claim.status);
  const catLabel = (k) => meta?.categories[k]?.label || (k === 'non_reimbursable' ? 'Non-reimbursable' : k === 'unknown' ? 'Unknown' : k) || '—';
  const errors = (r.validation || []).filter((f) => f.severity === 'error');
  const openClar = [...(claim.clarifications || [])].reverse().find((c) => !c.response);
  const shown = sections.find((s) => s.id === shownSection) || meta?.policy.sections.find((s) => s.id === shownSection);

  return (
    <section className="card detail">
      <div className="row-between">
        <div>
          <h2>
            {claim.claimant || 'Unknown claimant'} · {claim.amount ?? '—'} {claim.currency}
          </h2>
          <div className="small muted">Claim {claim._id} · submitted {fmtTime(claim.createdAt)}</div>
        </div>
        <StatusPill status={claim.status} />
      </div>

      <dl className="fields">
        <dt>Date</dt>
        <dd>{claim.date || <em className="muted">missing</em>}</dd>
        <dt>Category (entered)</dt>
        <dd>{claim.category || <em className="muted">missing</em>}</dd>
        <dt>Amount (USD)</dt>
        <dd>{money(claim.amountUSD)}</dd>
        <dt>Receipt</dt>
        <dd>{claim.receiptAvailable === true ? 'Yes' : claim.receiptAvailable === false ? 'No' : <em className="muted">not stated</em>}</dd>
        <dt>Description</dt>
        <dd>{claim.description || <em className="muted">missing</em>}</dd>
      </dl>

      <div className={`banner rec-${r.recommendation}`}>
        <div className="row-between">
          <strong>{REC_LABELS[r.recommendation] || 'Not reviewed'}</strong>
          <span className="small">
            {r.engine && r.engine !== 'heuristic'
              ? `AI-assisted (${r.model})`
              : cls.engine && cls.engine !== 'heuristic'
                ? 'Partly AI: category by AI, policy check heuristic'
                : 'Heuristic (no AI)'}{' '}
            · {fmtTime(r.runAt)}
          </span>
        </div>
        {r.summary && <p>{r.summary}</p>}
        {r.aiRecommendation && r.aiRecommendation !== r.recommendation && (
          <p className="small">
            The analysis suggested “{REC_LABELS[r.aiRecommendation]}”; automated checks raised this to “{REC_LABELS[r.recommendation]}”.
          </p>
        )}
        {r.aiCalls?.length > 0 && (
          <p className="small muted">
            AI calls:{' '}
            {r.aiCalls
              .map((c) => `${c.purpose} ${c.ok ? '✓' : '✗'} ${(c.durationMs / 1000).toFixed(1)}s${c.attempts > 1 ? ` (${c.attempts} attempts)` : ''}${c.tokens?.total ? ` · ${c.tokens.total} tokens` : ''}`)
              .join(' · ')}
          </p>
        )}
        {r.error && <p className="small warn-text">AI unavailable for this run ({r.error}); showing heuristic analysis.</p>}
        {!r.error && r.engine === 'heuristic' && (
          <p className="small warn-text">
            {meta?.ai.enabled
              ? 'AI is now enabled on the server, but this review ran without it — click “Re-run review”.'
              : `AI is off on the server: ${meta?.ai.offReason || 'no Gemini API key.'}`}
          </p>
        )}
        <p className="small muted">Advisory only — the decision is yours.</p>
      </div>

      <Section title="Classification">
        <div className="row-wrap">
          <span>
            Used for checks: <strong>{catLabel(r.effectiveCategory) || 'none'}</strong> <span className="muted small">({r.categorySource})</span>
          </span>
          {cls.uncertain && <span className="pill pill-uncertain">Uncertain classification</span>}
          {cls.mismatch && <span className="pill pill-warn">Differs from claimant’s category</span>}
        </div>
        <div className="small">
          Suggested: <strong>{catLabel(cls.suggested)}</strong> · confidence{' '}
          <span className="conf">
            <span className="conf-bar" style={{ width: `${Math.round((cls.confidence || 0) * 100)}%` }} />
          </span>{' '}
          {Math.round((cls.confidence || 0) * 100)}% ({cls.engine})
          {cls.alternatives?.length > 0 && <> · alternatives: {cls.alternatives.map(catLabel).join(', ')}</>}
        </div>
        {cls.rationale && <div className="small muted">{cls.rationale}</div>}
        {claim.categoryOverride?.category && (
          <div className="small">
            Overridden to <strong>{catLabel(claim.categoryOverride.category)}</strong> by {claim.categoryOverride.by}: “{claim.categoryOverride.reason}”
          </div>
        )}
      </Section>

      <Section title={`Automated checks (${(r.validation || []).length})`}>
        {(r.validation || []).length === 0 ? (
          <div className="small ok-text">✓ All deterministic checks passed (fields, dates, receipt, limits, duplicates).</div>
        ) : (
          <ul className="checks">
            {r.validation.map((f, i) => (
              <li key={i} className={`check sev-${f.severity}`}>
                <span className="sev">{SEVERITY_ICON[f.severity]}</span> <code>{f.code}</code> {f.message}{' '}
                {f.sectionId && (
                  <button className="link small" onClick={() => setShownSection(f.sectionId)}>
                    [{f.sectionId}]
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Policy findings">
        {(r.findings || []).length === 0 && <div className="small muted">No findings.</div>}
        {(r.findings || []).map((f, i) => (
          <div key={i} className={`finding a-${f.assessment}`}>
            <div>
              <span className={`pill a-pill-${f.assessment}`}>{ASSESSMENT_LABEL[f.assessment] || f.assessment}</span> {f.statement}
              {f.uncited && <span className="pill pill-uncertain">Unverified evidence</span>}
            </div>
            <CitationList citations={f.citations} sections={sections} onShow={setShownSection} />
          </div>
        ))}
      </Section>

      {shown && (
        <div className="policy-quote">
          <div className="row-between">
            <strong>
              [{shown.id}] {shown.heading}
            </strong>
            <button className="link" onClick={() => setShownSection(null)}>
              close
            </button>
          </div>
          <p>{shown.text}</p>
        </div>
      )}

      <Section title={`Retrieved policy sections (${sections.length})`}>
        <div className="row-wrap">
          {sections.map((s) => (
            <button key={s.id} className="chip" title={s.reason} onClick={() => setShownSection(s.id)}>
              {s.id} · {s.heading.replace(/^[\d.]+\s*/, '')}
            </button>
          ))}
        </div>
      </Section>

      {(claim.clarifications || []).length > 0 && (
        <Section title="Clarifications">
          {claim.clarifications.map((c) => (
            <div key={c._id} className="clar">
              <div className="small muted">
                Asked by {c.requestedBy} · {fmtTime(c.requestedAt)}
              </div>
              {c.message && <p>{c.message}</p>}
              {c.questions?.length > 0 && (
                <ul>
                  {c.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              )}
              {c.response ? (
                <p>
                  <strong>{c.respondedBy}:</strong> {c.response} <span className="small muted">{fmtTime(c.respondedAt)}</span>
                </p>
              ) : (
                <p className="small warn-text">{claim.status === 'needs_clarification' ? 'Awaiting response' : 'Closed without a response'}</p>
              )}
            </div>
          ))}
        </Section>
      )}

      {claim.status === 'needs_clarification' && openClar && (
        <Section title="Claimant response (simulated)">
          <p className="small muted">Records the claimant’s answer and any corrected fields, then re-runs the review.</p>
          <textarea placeholder="Response from the claimant" value={response.text} onChange={(e) => setResponse({ ...response, text: e.target.value })} />
          <div className="row-wrap">
            <label className="small">
              Receipt{' '}
              <select value={response.receipt} onChange={(e) => setResponse({ ...response, receipt: e.target.value })}>
                <option value="">unchanged</option>
                <option value="yes">yes</option>
                <option value="no">no</option>
              </select>
            </label>
            <label className="small">
              Category <input className="input-sm" placeholder="unchanged" value={response.category} onChange={(e) => setResponse({ ...response, category: e.target.value })} />
            </label>
          </div>
          <input placeholder="Updated description (optional)" value={response.description} onChange={(e) => setResponse({ ...response, description: e.target.value })} />
          <button
            disabled={!!busy || !response.text.trim()}
            onClick={async () => {
              const updates = {};
              if (response.receipt) updates.receiptAvailable = response.receipt;
              if (response.category.trim()) updates.category = response.category.trim();
              if (response.description.trim()) updates.description = response.description.trim();
              if (await act('Submitting response…', (c) => `Response recorded and claim re-reviewed: ${REC_LABELS[c.review?.recommendation] || 'done'}.`, () => api.respond(claim._id, { response: response.text, updates }))) setResponse({ text: '', receipt: '', category: '', description: '' });
            }}
          >
            Submit response &amp; re-review
          </button>
        </Section>
      )}

      {!final && (
        <Section title="Reviewer actions">
          <textarea placeholder="Note / reason (required to reject, or to approve a claim with failed checks)" value={note} onChange={(e) => setNote(e.target.value)} />
          {questions.length > 0 && (
            <div className="small">
              Questions to send with a clarification request:
              <ul className="questions">
                {questions.map((q, i) => (
                  <li key={i}>
                    <input value={q} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button className="link" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="link small" onClick={() => setQuestions([...questions, ''])}>
            + add question
          </button>
          <div className="actions">
            <button
              className="btn-approve"
              disabled={!!busy || (errors.length > 0 && !note.trim())}
              onClick={() => act('Approving…', 'Claim approved.', () => api.decide(claim._id, { action: 'approve', note }))}
            >
              Approve
            </button>
            <button className="btn-reject" disabled={!!busy || !note.trim()} onClick={() => act('Rejecting…', 'Claim rejected.', () => api.decide(claim._id, { action: 'reject', note }))}>
              Reject
            </button>
            <button
              className="btn-clarify"
              disabled={!!busy || claim.status === 'needs_clarification' || (!note.trim() && !questions.some((q) => q.trim()))}
              onClick={() =>
                act('Sending request…', 'Clarification requested from the claimant.', () =>
                  api.decide(claim._id, { action: 'request_clarification', note, questions: questions.filter((q) => q.trim()) }),
                )
              }
            >
              Request clarification
            </button>
            <button disabled={!!busy} onClick={() => act('Re-running review…', (c) => `Review re-run: ${REC_LABELS[c.review?.recommendation] || 'done'}.`, () => api.rereview(claim._id))}>
              Re-run review
            </button>
            {busy && <span className="small muted">{busy}</span>}
          </div>
          <ul className="hints small">
            {errors.length > 0 && !note.trim() && <li>Approving needs a note: {errors.length} automated check(s) failed.</li>}
            {!note.trim() && <li>Rejecting needs a reason in the note.</li>}
            {claim.status === 'needs_clarification' && <li>A clarification request is already open — wait for the claimant’s response.</li>}
            {claim.status !== 'needs_clarification' && !note.trim() && !questions.some((q) => q.trim()) && <li>Requesting clarification needs a message or at least one question.</li>}
          </ul>

          <div className="override">
            <strong className="small">Override classification</strong>
            <div className="row-wrap">
              <select value={override.category} onChange={(e) => setOverride({ ...override, category: e.target.value })}>
                <option value="">Choose category…</option>
                {(meta?.categoryKeys || [])
                  .filter((k) => k !== 'unknown')
                  .map((k) => (
                    <option key={k} value={k}>
                      {catLabel(k)}
                    </option>
                  ))}
              </select>
              <input className="grow" placeholder="Reason for override (required)" value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} />
              <button
                disabled={!!busy || !override.category || override.reason.trim().length < 5}
                onClick={async () => {
                  if (await act('Overriding…', `Category set to ${catLabel(override.category)}; checks re-run.`, () => api.override(claim._id, override))) {
                    setOverride({ category: '', reason: '' });
                  }
                }}
              >
                Override &amp; re-check
              </button>
            </div>
            {(override.category || override.reason) && (!override.category || override.reason.trim().length < 5) && (
              <div className="small warn-text">{!override.category ? 'Choose a category.' : 'Give a reason of at least 5 characters.'}</div>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Review & decision history"
        right={
          <button className="link small" onClick={() => setShowReviews(!showReviews)}>
            {showReviews ? 'hide' : 'show'} all {claim.reviews?.length || 0} review runs
          </button>
        }
      >
        <ol className="timeline">
          {(claim.history || []).map((h, i) => (
            <li key={i}>
              <div className="small muted">
                {fmtTime(h.at)} · {h.actor}
              </div>
              <div>
                <strong>{HISTORY_LABEL[h.type] || h.type}</strong>
                {h.action && <> — {h.action.replace('_', ' ')}</>}
                {h.type === 'ai_review' && h.details && (
                  <>
                    {' '}
                    — <RecPill rec={h.details.recommendation} /> {h.details.engine}, suggested {catLabel(h.details.suggestedCategory)} ({Math.round((h.details.confidence || 0) * 100)}%)
                    {h.details.uncertain && ' · uncertain'}
                  </>
                )}
                {h.type === 'override' && h.details && (
                  <>
                    {' '}
                    — {catLabel(h.details.from?.effectiveCategory) || 'none'} → {catLabel(h.details.to)}
                  </>
                )}
                {h.type === 'decision' && h.details?.aiRecommendation && <span className="small muted"> (system recommended: {REC_LABELS[h.details.aiRecommendation]})</span>}
              </div>
              {h.note && <div className="small">“{h.note}”</div>}
              {h.type === 'clarification_response' && h.details?.changed && Object.keys(h.details.changed).length > 0 && (
                <div className="small muted">
                  Changed: {Object.entries(h.details.changed).map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`).join('; ')}
                </div>
              )}
            </li>
          ))}
        </ol>
        {showReviews && (
          <div className="reviews">
            {(claim.reviews || []).map((rv, i) => (
              <details key={i}>
                <summary>
                  Run {i + 1} · {fmtTime(rv.runAt)} · {REC_LABELS[rv.recommendation]} · {rv.engine}
                </summary>
                <pre>{JSON.stringify({ classification: rv.classification, effectiveCategory: rv.effectiveCategory, validation: rv.validation, findings: rv.findings, questions: rv.questions }, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
      </Section>
    </section>
  );
}
