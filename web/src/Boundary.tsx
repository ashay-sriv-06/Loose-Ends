import { useEffect, useMemo, useState } from 'react';
import type { CheckResult, Dependency, Run } from '../../src/domain/model.ts';

const WHERE: Record<Dependency['availability'], string> = {
  'included-in-delivery': 'Inside the folder you’re sending',
  'available-outside-delivery': 'On your computer, but outside the folder you’re sending',
  'missing-in-scope': 'Not found',
  'outside-authorized-scope': 'Outside what Loose Ends may read',
  'embedded-data': 'Built into the file',
  'cannot-establish': 'Cannot tell (web address or absolute path — not fetched)',
};
const base = (p: string) => p.split('/').pop() ?? p;
const ROW = 46;
const NODE_W = 190;
const NODE_H = 30;

interface Node {
  id: string;
  label: string;
  col: 0 | 1 | 2;
  row: number;
  kind: 'delivered' | 'outside' | 'missing' | 'unknown';
}

/**
 * "What your client gets": a file-boundary picture built only from dependency
 * records. Layout is a pure function of sorted paths, so it never moves between renders.
 */
export function BoundaryView({ run, checks, onShow, initialFocus }: { run: Run; checks: CheckResult[]; onShow: (checkId: string) => void; initialFocus?: string | null }) {
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
  useEffect(() => setFocus(initialFocus ?? null), [initialFocus, run.id]);
  const deps = run.dependencies.filter((d) => d.availability !== 'embedded-data');
  const delivered = run.artifacts.filter((a) => a.inDelivery);

  const { nodes, edges, height, unlinked } = useMemo(() => {
    const referenced = new Set(deps.filter((d) => d.availability === 'included-in-delivery' && d.resolvedTarget).map((d) => d.resolvedTarget!));
    const sources = new Set(deps.map((d) => d.sourcePath));
    const nodes = new Map<string, Node>();
    const colRows = [0, 0, 0];
    const add = (id: string, label: string, col: 0 | 1 | 2, kind: Node['kind']) => {
      if (!nodes.has(id)) nodes.set(id, { id, label, col, row: colRows[col]++, kind });
    };
    for (const p of [...sources].sort()) if (!referenced.has(p)) add(p, base(p), 0, 'delivered');
    for (const p of [...referenced].sort()) add(p, base(p), 1, 'delivered');
    const outside = deps.filter((d) => d.availability !== 'included-in-delivery').sort((a, b) => (a.resolvedTarget ?? a.reference).localeCompare(b.resolvedTarget ?? b.reference));
    for (const d of outside) {
      const id = `out:${d.resolvedTarget ?? d.reference}`;
      add(id, d.resolvedTarget ?? d.reference, 2, d.availability === 'available-outside-delivery' ? 'outside' : d.availability === 'missing-in-scope' ? 'missing' : 'unknown');
    }
    const edges = deps.map((d) => ({
      dep: d,
      from: d.sourcePath,
      to: d.availability === 'included-in-delivery' ? d.resolvedTarget! : `out:${d.resolvedTarget ?? d.reference}`,
      bad: d.essential && d.availability !== 'included-in-delivery',
    }));
    const linked = new Set([...sources, ...referenced]);
    return { nodes, edges, height: Math.max(colRows[0], colRows[1], colRows[2], 1) * ROW + 70, unlinked: delivered.filter((a) => !linked.has(a.path)) };
  }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const X = [26, 262, 520];
  const pos = (n: Node) => ({ x: X[n.col], y: 52 + n.row * ROW });
  const related = (id: string) => !focus || id === focus || edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
  const checkFor = (d: Dependency) => checks.find((c) => c.id.endsWith(`::${d.id}`));

  return (
    <div className="boundary">
      <p className="lede">
        Your client only receives what is inside <span className="mono">{run.deliveryPath || 'the selected folder'}</span>. This shows which delivered files pull in other files, and where those files sit. It is a
        file-boundary picture — not a test of your client’s software.
      </p>

      {deps.length === 0 ? (
        <p className="calm">None of the {delivered.length} delivered files that Loose Ends can read pulls in another file.</p>
      ) : (
        <div className="graph-wrap">
          <svg className="graph" viewBox={`0 0 740 ${height}`} role="group" aria-label="Which delivered files depend on which other files">
            <rect className="zone inside" x="10" y="10" width="466" height={height - 20} rx="10" />
            <text className="zone-label" x="26" y="33">
              Inside the folder you’re sending
            </text>
            <rect className="zone outside" x="500" y="10" width="230" height={height - 20} rx="10" />
            <line className="boundary-line" x1="488" y1="14" x2="488" y2={height - 14} />
            <text className="zone-label" x="516" y="33">
              Left behind / not reachable
            </text>
            {edges.map((e, i) => {
              const a = nodes.get(e.from);
              const b = nodes.get(e.to);
              if (!a || !b) return null;
              const pa = pos(a);
              const pb = pos(b);
              const same = a.col === b.col;
              const x1 = pa.x + NODE_W;
              const y1 = pa.y + NODE_H / 2;
              const x2 = same ? pb.x + NODE_W : pb.x;
              const y2 = pb.y + NODE_H / 2 + (same ? 4 : 0);
              const d = same ? `M${x1} ${y1} C ${x1 + 34} ${y1}, ${x2 + 34} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
              const on = !focus || e.from === focus || e.to === focus;
              const crosses = b.col === 2;
              return <path key={i} d={d} pathLength={e.dep.essential ? 1 : undefined} style={{ ['--delay' as string]: `${crosses ? 380 : 80}ms` }} className={`edge ${e.bad ? 'bad' : ''} ${e.dep.essential ? '' : 'soft'} ${crosses ? 'crosses' : ''} ${on ? '' : 'dim'}`} markerEnd={`url(#arrow${e.bad ? '-bad' : ''})`} />;
            })}
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" className="arrow" />
              </marker>
              <marker id="arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" className="arrow bad" />
              </marker>
            </defs>
            {[...nodes.values()].map((n) => {
              const p = pos(n);
              return (
                <g
                  key={n.id}
                  className={`node col-${n.col} kind-${n.kind} ${focus === n.id ? 'is-focus' : ''} ${related(n.id) ? '' : 'dim'}`}
                  transform={`translate(${p.x} ${p.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={focus === n.id}
                  aria-label={`${n.label}. Show only its links.`}
                  onClick={() => setFocus(focus === n.id ? null : n.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setFocus(focus === n.id ? null : n.id))}
                >
                  <rect width={NODE_W} height={NODE_H} rx="7" />
                  <text x="10" y="19.5">
                    {n.label.length > 26 ? '…' + n.label.slice(-25) : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="fine">
            Files keep their place; select one to show only its links. A line that crosses the boundary is something your client will not receive. Solid lines are images a file needs in order to display; dashed lines are plain links.
            {unlinked.length > 0 && ` ${unlinked.length} other delivered ${unlinked.length === 1 ? 'file has' : 'files have'} no links and ${unlinked.length === 1 ? 'is' : 'are'} not drawn.`}
          </p>
        </div>
      )}

      {deps.length > 0 && (
        <div className="table-wrap">
          <table className="dep-table">
            <caption>The same information as a table</caption>
            <thead>
              <tr>
                <th>Delivered file</th>
                <th>Reference, as written</th>
                <th>Points to</th>
                <th>Where that is</th>
                <th>Needed to display?</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deps.map((d) => {
                const c = checkFor(d);
                const on = !focus || d.sourcePath === focus || d.resolvedTarget === focus || `out:${d.resolvedTarget ?? d.reference}` === focus;
                return (
                  <tr key={d.id} className={`${d.essential && d.availability !== 'included-in-delivery' ? 'is-bad' : ''} ${on ? '' : 'dim'}`}>
                    <td className="mono">{d.sourcePath}</td>
                    <td className="mono">{d.reference}</td>
                    <td className="mono">{d.resolvedTarget ?? '—'}</td>
                    <td>{WHERE[d.availability]}</td>
                    <td>{d.essential ? 'Yes — an image it displays' : 'No — a plain link'}</td>
                    <td>
                      {c && (
                        <button className="btn tiny" onClick={() => onShow(c.id)}>
                          Show me
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {run.coverage.gaps.length > 0 && (
        <div className="gaps">
          <h3>Not fully inspected</h3>
          <ul>
            {run.coverage.gaps.map((g, i) => (
              <li key={i}>
                {g.path && <span className="mono">{g.path} — </span>}
                {g.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
