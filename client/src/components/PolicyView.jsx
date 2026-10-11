export default function PolicyView({ meta }) {
  if (!meta) return null;
  return (
    <div className="grid-2">
      <section className="card">
        <h2>{meta.policy.title}</h2>
        {meta.policy.sections.map((s) => (
          <div key={s.id} className="policy-section" id={`sec-${s.id}`}>
            <h3>
              <code>{s.id}</code> {s.heading}
            </h3>
            <p>{s.text}</p>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Configured limits</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Per claim (USD)</th>
              <th>Section</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(meta.categories).map(([k, c]) => (
              <tr key={k}>
                <td>
                  {c.label} <span className="muted small">({k})</span>
                </td>
                <td className="num">
                  {c.limitUSD}
                  {c.dailyLimitUSD ? ` (${c.dailyLimitUSD}/day)` : ''}
                </td>
                <td>
                  <code>{c.policySection}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">Receipt required from USD {meta.receiptThresholdUSD}. Supported currencies: {meta.currencies.join(', ')}.</p>
      </section>
    </div>
  );
}
