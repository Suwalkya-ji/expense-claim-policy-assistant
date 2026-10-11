import { useEffect, useState } from 'react';
import { api, money, STATUS_LABELS } from '../api.js';

function Table({ title, rows, label }) {
  const entries = Object.entries(rows || {}).sort((a, b) => b[1].totalUSD - a[1].totalUSD);
  return (
    <div>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>{title.replace('By ', '')}</th>
            <th className="num">Claims</th>
            <th className="num">Total (USD)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td>{label ? label(k) : k}</td>
              <td className="num">{v.count}</td>
              <td className="num">{money(v.totalUSD, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Totals({ meta }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('excludingRejected');
  useEffect(() => {
    api.summary().then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="card alert-error">Could not load totals: {error}</div>;
  if (!data) return <div className="card">Loading…</div>;
  const t = data[scope];
  if (data.all.count === 0) return <div className="card empty">No claims yet — totals appear once claims are submitted.</div>;
  const catLabel = (k) => meta?.categories[k]?.label || k;
  return (
    <section className="card">
      <div className="row-between">
        <h2>Totals: {money(t.totalUSD)} across {t.count} claims</h2>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="excludingRejected">Excluding rejected</option>
          <option value="all">All claims</option>
        </select>
      </div>
      <p className="small muted">Converted to USD at configured rates.{t.unconvertible > 0 && ` ${t.unconvertible} claim(s) excluded: amount or currency invalid.`}</p>
      <div className="grid-3">
        <Table title="By claimant" rows={t.byClaimant} />
        <Table title="By category" rows={t.byCategory} label={catLabel} />
        <Table title="By status" rows={t.byStatus} label={(k) => STATUS_LABELS[k] || k} />
      </div>
    </section>
  );
}
