import { useEffect, useRef, useState } from 'react';
import { api, type TreeEntry } from './api.ts';

interface Props {
  rootId: string;
  roots: { id: string; label: string; kind: string }[];
  mode: 'folder' | 'files';
  title: string;
  hint: string;
  initial: string[];
  onClose: () => void;
  onChoose: (rootId: string, paths: string[]) => void;
}

/** Browses only the folders Loose Ends is allowed to read. The browser never supplies an absolute path. */
export function Picker({ rootId: initialRoot, roots, mode, title, hint, initial, onClose, onChoose }: Props) {
  const [rootId, setRootId] = useState(initialRoot);
  const startDir = initial[0] ? initial[0].split('/').slice(0, -1).join('/') : '';
  const [dir, setDir] = useState(startDir);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [picked, setPicked] = useState<string[]>(mode === 'files' ? initial : []);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError('');
    api
      .tree(rootId, dir)
      .then((t) => setEntries(t.entries))
      .catch((e) => {
        setEntries([]);
        setError((e as Error).message);
      });
  }, [rootId, dir]);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const crumbs = dir ? dir.split('/') : [];
  const rootLabel = roots.find((r) => r.id === rootId)?.label ?? 'Folder';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        <p className="fine">{hint}</p>
        {roots.length > 1 && (
          <select
            className="select"
            aria-label="Folder Loose Ends may read"
            value={rootId}
            onChange={(e) => {
              setRootId(e.target.value);
              setDir('');
              setPicked([]);
            }}
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        )}
        <nav className="crumbs mono" aria-label="Location">
          <button className="link" onClick={() => setDir('')}>
            {rootLabel}
          </button>
          {crumbs.map((c, i) => (
            <span key={i}>
              {' / '}
              <button className="link" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        {error && <p className="inline-error">{error}</p>}
        <ul className="tree">
          {entries.length === 0 && !error && <li className="fine">This folder is empty.</li>}
          {entries.map((e) =>
            e.type === 'dir' ? (
              <li key={e.path}>
                <button className="tree-row" onClick={() => setDir(e.path)}>
                  <span className="folder-glyph" aria-hidden="true" />
                  <span className="mono">{e.name}/</span>
                </button>
              </li>
            ) : (
              <li key={e.path}>
                {mode === 'files' ? (
                  <label className="tree-row">
                    <input type="checkbox" checked={picked.includes(e.path)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.path] : picked.filter((p) => p !== e.path))} />
                    <span className="mono">{e.name}</span>
                  </label>
                ) : (
                  <span className="tree-row is-file">
                    <span className="mono">{e.name}</span>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
        {mode === 'files' && picked.length > 0 && <p className="fine mono">Chosen: {picked.join(', ')}</p>}
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          {mode === 'folder' ? (
            <button className="btn primary" onClick={() => onChoose(rootId, [dir])}>
              Send this folder{dir ? `: ${dir.split('/').pop()}` : ''}
            </button>
          ) : (
            <button className="btn primary" onClick={() => onChoose(rootId, picked)}>
              {picked.length ? `Use ${picked.length} ${picked.length === 1 ? 'file' : 'files'}` : 'Use none'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
