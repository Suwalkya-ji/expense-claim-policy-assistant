import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ClaimList from './components/ClaimList.jsx';
import ClaimDetail from './components/ClaimDetail.jsx';
import SubmitClaims from './components/SubmitClaims.jsx';
import Totals from './components/Totals.jsx';
import PolicyView from './components/PolicyView.jsx';

const TABS = [
  ['queue', 'Review queue'],
  ['submit', 'Submit claims'],
  ['totals', 'Totals'],
  ['policy', 'Policy'],
];

export default function App() {
  const [tab, setTab] = useState('queue');
  const [meta, setMeta] = useState(null);
  const [claims, setClaims] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0); // bumps to reload the open claim after a bulk re-review
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); // success message, auto-dismissed
  const [metaError, setMetaError] = useState('');
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem('reviewer') || 'reviewer');

  const loadMeta = useCallback(() => {
    api
      .meta()
      .then((m) => {
        setMeta(m);
        setMetaError('');
      })
      .catch((e) => setMetaError(e.message));
  }, []);
  useEffect(loadMeta, [loadMeta]);

  const refresh = useCallback(() => {
    api
      .claims(statusFilter)
      .then(setClaims)
      .catch((e) => setError(`Could not load claims: ${e.message}`))
      .finally(() => setLoadingClaims(false));
  }, [statusFilter]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const updateReviewer = (v) => {
    setReviewer(v);
    localStorage.setItem('reviewer', v || 'reviewer');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Expense Claim Review</h1>
          {meta && <span className="muted small">{meta.policy.title}</span>}
        </div>
        <div className="topbar-right">
          {meta && (
            <span className={`pill ${meta.ai.enabled ? 'pill-ai' : 'pill-warn'}`} title={meta.ai.enabled ? 'Classification and policy explanations by the AI model' : meta.ai.offReason || 'Set GEMINI_API_KEY in server/.env and restart the server'}>
              {meta.ai.enabled ? `AI: ${meta.ai.model}` : 'AI off · heuristic fallback'}
            </span>
          )}
          <label className="small">
            Reviewer{' '}
            <input value={reviewer} onChange={(e) => updateReviewer(e.target.value)} className="input-sm" />
          </label>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {metaError && (
        <div className="alert alert-error" role="alert">
          Cannot reach the server ({metaError}). Check that the API is running.{' '}
          <button
            className="link"
            onClick={() => {
              loadMeta();
              refresh();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert" onClick={() => setError('')}>
          {error} <span className="muted">(click to dismiss)</span>
        </div>
      )}
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice('')}>
          ✓ {notice}
        </div>
      )}

      <main>
        {tab === 'queue' && (
          <div className="split">
            <ClaimList
              claims={claims}
              loading={loadingClaims}
              meta={meta}
              selectedId={selectedId}
              onSelect={setSelectedId}
              statusFilter={statusFilter}
              onFilter={setStatusFilter}
              onReviewed={() => {
                refresh();
                setReloadKey((k) => k + 1);
              }}
              onError={setError}
              onNotice={setNotice}
            />
            {selectedId ? (
              <ClaimDetail key={`${selectedId}-${reloadKey}`} id={selectedId} meta={meta} onChanged={refresh} onError={setError} onNotice={setNotice} />
            ) : (
              <div className="card empty">Select a claim to see its review.</div>
            )}
          </div>
        )}
        {tab === 'submit' && (
          <SubmitClaims
            meta={meta}
            onSubmitted={(created) => {
              const needAttention = created.filter((c) => c.review?.recommendation !== 'comply').length;
              setNotice(`Submitted and reviewed ${created.length} claim(s)${needAttention ? `; ${needAttention} need attention` : ''}.`);
              refresh();
              setSelectedId(created[0]?._id ?? null);
              setTab('queue');
            }}
          />
        )}
        {tab === 'totals' && <Totals meta={meta} />}
        {tab === 'policy' && <PolicyView meta={meta} />}
      </main>
    </div>
  );
}
