import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Loading, StatusPill } from '../components/ui';
import { auditLogs, type AuditEvent, type AuditFilters, type AuditOptions, type AuditPage } from '../services/auditLogs';
import { errorMessage } from '../services/api';

function initialFilters(search: string): AuditFilters {
  const parameters = new URLSearchParams(search); const today = new Date(); const from = new Date(today.getTime() - 29 * 86400000);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10), actorId: parameters.get('actorId') || '', resourceId: parameters.get('resourceId') || '', resourceType: parameters.get('resourceType') || '', pharmacyId: parameters.get('pharmacyId') || '', family: '', action: '', limit: 25 };
}
export function AuditLogViewerPage() {
  const { user } = useAuth(); const location = useLocation(); const can = (permission: string) => Boolean(user?.permissions?.includes('*') || user?.permissions?.includes(permission)); const permitted = can('audit:read');
  const [draft, setDraft] = useState<AuditFilters>(() => initialFilters(location.search)); const [filters, setFilters] = useState(draft);
  const [history, setHistory] = useState<Array<string | undefined>>([undefined]); const [data, setData] = useState<AuditPage | null>(null); const [options, setOptions] = useState<AuditOptions | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [optionsError, setOptionsError] = useState(''); const [reload, setReload] = useState(0); const [selectedId, setSelectedId] = useState('');
  const searchRef = useRef(location.search);
  useEffect(() => { if (searchRef.current === location.search) return; searchRef.current = location.search; const value = initialFilters(location.search); setDraft(value); setFilters(value); setHistory([undefined]); setSelectedId(''); }, [location.search]);
  const cursor = history[history.length - 1]; const permissionKey = user?.permissions?.join(',');
  useEffect(() => {
    if (!permitted) { setLoading(false); setData(null); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    void auditLogs.list(filters, cursor, controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((failure) => { if (!controller.signal.aborted) { setData(null); setError(errorMessage(failure)); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, cursor, reload, permitted, permissionKey]);
  useEffect(() => {
    if (!permitted) { setOptions(null); return; }
    const controller = new AbortController(); setOptionsError('');
    void auditLogs.options(filters, controller.signal).then((value) => { if (!controller.signal.aborted) setOptions(value); }).catch((failure) => { if (!controller.signal.aborted) { setOptions(null); setOptionsError(errorMessage(failure)); } });
    return () => controller.abort();
  }, [filters, permitted, permissionKey, reload]);
  function refresh() { setSelectedId(''); setHistory([undefined]); setData(null); setReload((value) => value + 1); }
  function submit(event: FormEvent) { event.preventDefault(); setSelectedId(''); setHistory([undefined]); setFilters({ ...draft }); setData(null); }
  function field(name: keyof AuditFilters, value: string | number) { setDraft((current) => ({ ...current, [name]: value })); }
  function previous() { setSelectedId(''); if (data?.currentCursor) setHistory((current) => current.slice(0, -1)); }
  function next() { if (!data?.nextCursor) return; const firstCursor = data.currentCursor; setSelectedId(''); setHistory((current) => [...current.map((entry, index) => index === current.length - 1 && !entry ? firstCursor : entry), data.nextCursor!]); }
  return <div className="container page-section"><div className="page-intro"><div className="eyebrow">ADMINISTRATION</div><h1>Audit history</h1><p>Review recorded actions within your permitted event groups. Dates are inclusive UTC calendar days.</p><Link to="/admin">Back to administration</Link></div>
    {!permitted ? <Card><p>Your current policy does not allow audit access.</p></Card> : <>
      <Card className="settings-card"><form onSubmit={submit}><div className="audit-filter-grid">
        <Field label="From (UTC)" type="date" required value={draft.from} onChange={(event) => field('from', event.target.value)}/><Field label="To (UTC)" type="date" required value={draft.to} onChange={(event) => field('to', event.target.value)}/>
        <label className="field"><span>Event group</span><select value={draft.family || ''} onChange={(event) => field('family', event.target.value)}><option value="">All permitted groups</option>{options?.families.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}</select></label>
        <Field label="Exact action" list="audit-action-options" maxLength={120} value={draft.action || ''} onChange={(event) => field('action', event.target.value)}/><datalist id="audit-action-options">{options?.actions.map((action) => <option key={action} value={action}/>)}</datalist>
        <Field label="Acting account ID" pattern="[0-9a-fA-F]{24}" value={draft.actorId || ''} onChange={(event) => field('actorId', event.target.value)}/><Field label="Pharmacy ID" pattern="[0-9a-fA-F]{24}" value={draft.pharmacyId || ''} onChange={(event) => field('pharmacyId', event.target.value)}/>
        <Field label="Resource type" list="audit-resource-options" maxLength={80} value={draft.resourceType || ''} onChange={(event) => field('resourceType', event.target.value)}/><datalist id="audit-resource-options">{options?.resourceTypes.map((type) => <option key={type} value={type}/>)}</datalist><Field label="Resource ID" pattern="[0-9a-fA-F]{24}" value={draft.resourceId || ''} onChange={(event) => field('resourceId', event.target.value)}/>
        <label className="field"><span>Rows per page</span><select value={draft.limit} onChange={(event) => field('limit', Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
      </div><div className="settings-actions"><Button disabled={loading}>Apply filters</Button><Button type="button" className="button-outline" disabled={loading} onClick={refresh}>Refresh current filters</Button><Button type="button" className="button-outline" disabled={loading} onClick={() => { const value = initialFilters(''); setDraft(value); setFilters(value); setHistory([undefined]); setSelectedId(''); setData(null); }}>Clear filters</Button></div></form>
      <p className="report-note">Use a range of at most 366 days. Each page retains a fixed time cutoff; refresh to include newer events. Viewing records is itself audited.</p>{optionsError && <p className="report-note" role="status">Filter suggestions unavailable: {optionsError}</p>}{options?.optionsLimited && <p className="report-note">Suggestions are limited to 200 values per field. You can enter an exact action or resource type.</p>}</Card>
      {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={refresh}>Refresh audit view</Button></div>}
      {loading ? <Loading/> : data && <Card className="settings-card"><div className="table-wrap"><table><thead><tr><th>Time (local)</th><th>Action</th><th>Actor</th><th>Resource</th><th>Event</th></tr></thead><tbody>{data.logs.map((event) => <tr key={event._id}><td><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('en-IN')}</time></td><td>{event.action}<small>{event.family}</small></td><td>{event.actor ? <>{event.actor.name || 'Account'}<small>{can('user:read') ? <Link to={`/admin/users/${event.actor.id}`}>{event.actor.id}</Link> : event.actor.id}</small></> : 'System / not recorded'}</td><td>{event.resourceType || 'Not recorded'}<small>{event.resourceId}</small>{event.pharmacyId && <small>Pharmacy: {event.pharmacyId}</small>}</td><td><Button type="button" className="button-outline button-small" onClick={() => setSelectedId(event._id)}>View event</Button></td></tr>)}</tbody></table></div>{!data.logs.length && <p>No permitted events match these filters.</p>}
        <div className="support-pagination"><Button type="button" className="button-outline button-small" disabled={history.length <= 1} onClick={previous}>Previous</Button><span>Page {history.length} · {data.logs.length} events</span><Button type="button" className="button-outline button-small" disabled={!data.nextCursor} onClick={next}>Next</Button></div><p className="report-note">Cutoff: {new Date(data.snapshotAt).toLocaleString('en-IN')}. IP addresses and metadata details have separate permission checks.</p></Card>}
      {selectedId && <AuditEventPanel key={`${selectedId}-${permissionKey}`} id={selectedId} onClose={() => setSelectedId('')}/>}
    </>}
  </div>;
}
function AuditEventPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ event: AuditEvent; canViewDetails: boolean; canViewIp: boolean } | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); void auditLogs.event(id, controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [id]);
  return <Card className="settings-card"><div className="card-heading"><h2>Audit event</h2><Button type="button" className="button-outline button-small" onClick={onClose}>Close event</Button></div>{loading ? <Loading/> : error ? <div className="inline-error" role="alert">{error}</div> : data && <><StatusPill>{data.event.action}</StatusPill><p className="report-note">Event ID: {data.event._id} · {new Date(data.event.createdAt).toLocaleString('en-IN')}</p>{data.canViewIp && <p>Recorded IP: {data.event.ipAddress || 'Not recorded'}</p>}
    {data.canViewDetails ? <><h3>Permitted metadata</h3><pre className="audit-metadata">{JSON.stringify(data.event.metadata || {}, null, 2)}</pre><p className="report-note">Metadata is projected by event group and bounded for display. Known credential, private-path and support conversation fields are excluded. Permitted free text is not automatically anonymized.</p></> : <p>Your policy permits event summaries but does not permit metadata details.</p>}</>}</Card>;
}
