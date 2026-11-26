import { useEffect, useState } from 'react';
import { catalogue, type Category } from '../services/catalogue';
import { Button, Field, Loading } from '../components/ui';
import { errorMessage } from '../services/api';

export function CategoryChooser({ value, onChange, initial = [] }: { value: string[]; onChange: (ids: string[]) => void; initial?: Category[] }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [items, setItems] = useState<Category[]>([]); const [total, setTotal] = useState(0);
  const [known, setKnown] = useState<Category[]>(initial); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = window.setTimeout(() => { void catalogue.categories({ q: query.trim(), page }, controller.signal).then((result) => {
      if (controller.signal.aborted) return; setItems(result.categories); setTotal(result.total);
      setKnown((current) => [...new Map([...current, ...result.categories].map((entry) => [entry._id, entry])).values()]);
    }).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, page, reload]);
  return <section className="category-chooser" aria-label="Medicine categories"><h3>Categories</h3><p className="report-note">Choose up to 10 categories. An archived category may remain on an existing entry; new selections must be active.</p>
    <div className="category-selected">{value.map((id) => <Button key={id} type="button" className="button-outline button-small" onClick={() => onChange(value.filter((entry) => entry !== id))}>Remove {known.find((entry) => entry._id === id)?.name || id}</Button>)}</div>
    <Field label="Find categories" value={query} maxLength={100} onChange={(event) => { setQuery(event.target.value); setPage(1); }}/>
    <Button type="button" className="button-outline button-small" disabled={loading} onClick={() => setReload((current) => current + 1)}>Refresh categories</Button>
    {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={() => setReload((current) => current + 1)}>Retry</Button></div>}
    {loading ? <Loading/> : <div className="access-role-grid">{items.map((category) => <label className="settings-checkbox" key={category._id}><input type="checkbox" checked={value.includes(category._id)} disabled={!value.includes(category._id) && (category.active === false || value.length >= 10)} onChange={(event) => onChange(event.target.checked ? [...value, category._id] : value.filter((id) => id !== category._id))}/>{category.name}{category.active === false ? ' (archived)' : ''}</label>)}</div>}
    {!loading && !error && !items.length && <p>No categories match. Create categories in the Categories tab.</p>}
    <div className="support-pagination"><Button type="button" className="button-outline button-small" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</Button><span>Page {page} · {total} categories</span><Button type="button" className="button-outline button-small" disabled={page * 25 >= total || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
  </section>;
}
