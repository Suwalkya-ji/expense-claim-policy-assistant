import { useState } from 'react';
import { api } from '../api.js';
import { parseCsv } from '../csv.js';
import { fieldHints } from '../fieldHints.js';

const EMPTY = { claimant: '', date: '', category: '', amount: '', currency: 'USD', description: '', receiptAvailable: '' };

function parseBulk(text) {
  const t = text.trim();
  if (!t) throw new Error('Paste JSON or CSV first.');
  if (t.startsWith('[') || t.startsWith('{')) {
    const data = JSON.parse(t);
    return Array.isArray(data) ? data : data.claims || [data];
  }
  return parseCsv(t);
}

export default function SubmitClaims({ meta, onSubmitted }) {
  const [form, setForm] = useState(EMPTY);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('info'); // info | error
  const { hints, missing } = fieldHints(form, { currencies: meta?.currencies, receiptThresholdUSD: meta?.receiptThresholdUSD });
  const hint = (k) => (hints[k] ? <span className="field-hint">{hints[k]}</span> : null);

  const submit = async (claims) => {
    setBusy(true);
    setMsgKind('info');
    setMsg(claims.length > 1 ? `Submitting and reviewing ${claims.length} claims… this can take a while with AI review.` : 'Submitting and reviewing…');
    try {
      const created = await api.submit(claims);
      setMsg('');
      onSubmitted(created);
      return true;
    } catch (e) {
      setMsgKind('error');
      setMsg(`Submission failed: ${e.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Single claim</h2>
        <p className="small muted">Fields are not enforced here on purpose — incomplete claims are accepted and flagged by the review.</p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            submit([form]).then((ok) => ok && setForm(EMPTY));
          }}
        >
          <label>
            Claimant <input value={form.claimant} onChange={set('claimant')} />
          </label>
          <label>
            Date <input type="date" value={form.date} onChange={set('date')} />
            {hint('date')}
          </label>
          <label>
            Category
            <input list="cat-options" value={form.category} onChange={set('category')} placeholder="e.g. Meals, Travel, Other" />
            <datalist id="cat-options">
              {Object.values(meta?.categories || {}).map((c) => (
                <option key={c.label} value={c.label} />
              ))}
            </datalist>
          </label>
          <div className="row">
            <label className="grow">
              Amount <input inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={Boolean(hints.amount)} />
              {hint('amount')}
            </label>
            <label>
              Currency
              <input list="cur-options" value={form.currency} onChange={set('currency')} className="input-sm" />
              <datalist id="cur-options">
                {(meta?.currencies || []).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {hint('currency')}
            </label>
          </div>
          <label>
            Description <textarea value={form.description} onChange={set('description')} placeholder="What was it, and what was the business purpose?" />
          </label>
          <label>
            Receipt available
            <select value={form.receiptAvailable} onChange={set('receiptAvailable')}>
              <option value="">—</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
            {hint('receiptAvailable')}
          </label>
          {missing.length > 0 && missing.length < 7 && (
            <p className="small warn-text">Missing: {missing.join(', ')}. You can still submit — the review will ask the claimant for it.</p>
          )}
          <button disabled={busy || missing.length === 7}>{busy ? 'Submitting…' : 'Submit & review'}</button>
        </form>
      </section>

      <section className="card">
        <h2>Bulk import</h2>
        <p className="small muted">
          Paste a JSON array or CSV with header <code>claimant,date,category,amount,currency,description,receipt</code>.
        </p>
        <textarea className="bulk" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'claimant,date,category,amount,currency,description,receipt\nAna,2026-10-01,Meals,42,USD,Dinner on client trip,yes'} />
        <div className="actions">
          <button
            disabled={busy}
            onClick={() => {
              try {
                const claims = parseBulk(bulk);
                if (!claims.length) throw new Error('no claim rows found — the first line must be the header row.');
                submit(claims).then((ok) => ok && setBulk(''));
              } catch (e) {
                setMsgKind('error');
                setMsg(`Could not read the pasted data: ${e.message}`);
              }
            }}
          >
            {busy ? 'Importing…' : 'Import & review'}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              api
                .samples()
                .then(submit)
                .catch((e) => {
                  setMsgKind('error');
                  setMsg(`Could not load samples: ${e.message}`);
                })
            }
          >
            Load sample claims
          </button>
        </div>
        {msg && (
          <p className={msgKind === 'error' ? 'small alert alert-error' : 'small muted'} role={msgKind === 'error' ? 'alert' : 'status'}>
            {msg}
          </p>
        )}
      </section>
    </div>
  );
}
