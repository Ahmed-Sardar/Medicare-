import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../services/api';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Loading, StatusPill } from '../components/ui';

type Person = { _id: string; name: string; email?: string };
type Pharmacy = { _id: string; name: string; city?: string; isDemo?: boolean };
type Comment = { _id?: string; authorId?: Person | null; body: string; at: string };
type StatusEvent = { _id?: string; status: string; actorId?: Person | null; at: string; resolutionNotes?: string };
type Ticket = { _id: string; subject: string; category: string; priority: string; status: string; revision?: number; retentionHold?: boolean; contentPurgedAt?: string; requesterId?: Person | null; assignedTo?: Person | null; pharmacyId?: Pharmacy | null; comments?: Comment[]; statusHistory?: StatusEvent[]; resolutionNotes?: string; updatedAt: string };
type TicketSummary = { tickets: Ticket[]; total: number };
const statuses = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
const categories = ['ACCOUNT', 'PHARMACY', 'RESERVATION', 'INVENTORY', 'OTHER'];
const priorities = ['LOW', 'NORMAL', 'HIGH'];
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();

export function SupportPage() {
  const { user } = useAuth();
  return <div className="container page-section"><div className="page-intro"><div className="eyebrow">SUPPORT</div><h1>How can we help?</h1><p>Create a ticket and follow the conversation with our support team.</p></div>{user ? <SupportDesk manager={false}/> : <Card><p>Log in to create and track support tickets.</p><Link to="/login" className="button">Log in</Link></Card>}</div>;
}
export function SupportInboxPage() { const { user } = useAuth(); const permitted = user?.permissions?.includes('*') || user?.permissions?.includes('support:manage'); return <div className="container page-section"><div className="page-intro"><div className="eyebrow">SUPPORT OPERATIONS</div><h1>Support inbox</h1><p>Assign tickets, respond to customers and record resolutions.</p></div>{permitted ? <SupportDesk manager/> : <Card><p>Your current policy does not allow support management.</p><Link to="/support">View your own support tickets</Link></Card>}</div>; }

function SupportDesk({ manager }: { manager: boolean }) {
  const location = useLocation();
  const [tickets, setTickets] = useState<Ticket[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [priority, setPriority] = useState(''); const [assigned, setAssigned] = useState('');
  const [selectedId, setSelectedId] = useState(() => { const id = new URLSearchParams(location.search).get('ticket'); return id && /^[0-9a-f]{24}$/i.test(id) ? id : ''; }); const [ticket, setTicket] = useState<Ticket | null>(null); const [agents, setAgents] = useState<Person[] | null>(null);
  const [revision, setRevision] = useState(0); const [detailRevision, setDetailRevision] = useState(0); const [detailHasUpdate, setDetailHasUpdate] = useState(false); const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState(''); const [detailError, setDetailError] = useState('');
  const pageSize = 20;
  useEffect(() => { const id = new URLSearchParams(location.search).get('ticket'); if (id && /^[0-9a-f]{24}$/i.test(id)) setSelectedId(id); }, [location.search]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api.get('/support', { signal: controller.signal, params: { scope: manager ? 'all' : 'mine', page, limit: pageSize, ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(manager && assigned ? { assignedTo: assigned } : {}) } }).then(({ data }) => {
      if (controller.signal.aborted) return; const result = data.data as TicketSummary; const last = Math.max(1, Math.ceil(result.total / pageSize)); setTotal(result.total); if (page > last) { setPage(last); return; } setTickets(result.tickets);
    }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [manager, page, status, priority, assigned, revision]);
  useEffect(() => {
    if (!manager) return;
    void api.get('/support/agents').then(({ data }) => setAgents(data.data.agents)).catch(() => setAgents(null));
  }, [manager]);
  useEffect(() => {
    if (!selectedId) { setTicket(null); return; }
    const controller = new AbortController(); setDetailLoading(true); setDetailError(''); setDetailHasUpdate(false); setTicket(null);
    void api.get(`/support/${selectedId}`, { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setTicket(data.data.ticket); }).catch((err) => { if (!controller.signal.aborted) setDetailError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, detailRevision]);
  useEffect(() => {
    const listener = (event: Event) => { const payload = (event as CustomEvent<{ data?: { ticketId?: string } }>).detail; const id = payload?.data?.ticketId; if (!id) return; setRevision((value) => value + 1); if (id === selectedId) setDetailHasUpdate(true); };
    window.addEventListener('medfind:notification', listener); return () => window.removeEventListener('medfind:notification', listener);
  }, [selectedId]);
  function updated(value: Ticket) { setTicket((current) => current?._id === value._id ? value : current); if (value._id === selectedId) setDetailHasUpdate(false); setRevision((current) => current + 1); }
  function created(value: Ticket) { setTicket(value); setSelectedId(value._id); setRevision((current) => current + 1); }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="support-desk">{!manager && <NewTicket onCreated={created}/>}
    <div className="support-controls"><label className="field"><span>Status</span><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{statuses.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label><label className="field"><span>Priority</span><select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}><option value="">All</option>{priorities.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>{manager && <label className="field"><span>Assignment</span><select value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1); }}><option value="">All</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option></select></label>}<Button type="button" className="button-outline" onClick={() => setRevision((value) => value + 1)}>Refresh list</Button></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="support-columns"><Card className="support-list"><h2>{manager ? 'Tickets' : 'Your tickets'}</h2>{loading ? <Loading/> : tickets.length ? tickets.map((item) => <button type="button" className={`support-list-item ${selectedId === item._id ? 'support-list-selected' : ''}`} key={item._id} onClick={() => setSelectedId(item._id)}><span><strong>{item.subject}</strong><small>{label(item.category)} - {label(item.priority)} priority{manager && item.requesterId ? ` - ${item.requesterId.name}` : ''}</small></span><StatusPill tone={item.status === 'RESOLVED' || item.status === 'CLOSED' ? 'good' : 'warn'}>{label(item.status)}</StatusPill></button>) : <p>No tickets match these filters.</p>}
      <div className="support-pagination"><Button type="button" className="button-outline button-small" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" className="button-outline button-small" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </Card><Card className="support-detail">{detailLoading ? <Loading/> : detailError ? <div className="inline-error" role="alert">{detailError} <button onClick={() => setDetailRevision((value) => value + 1)}>Retry</button></div> : ticket ? <>{detailHasUpdate && <div className="support-update-notice" role="status">This ticket has a new update. Your draft is still here. <button type="button" onClick={() => setDetailRevision((value) => value + 1)}>Refresh ticket</button></div>}<TicketDetail key={`${ticket._id}:${ticket.revision ?? 0}`} ticket={ticket} manager={manager} agents={agents} onUpdated={updated} onReload={() => setDetailRevision((value) => value + 1)}/></> : <p>Select a ticket to view its conversation.</p>}</Card></div>
  </div>;
}

function NewTicket({ onCreated }: { onCreated: (ticket: Ticket) => void }) {
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [category, setCategory] = useState('OTHER'); const [priority, setPriority] = useState('NORMAL'); const [pharmacyId, setPharmacyId] = useState(''); const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]); const [pharmacyNotice, setPharmacyNotice] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { void Promise.allSettled([api.get('/pharmacies'), api.get('/pharmacies/mine')]).then((results) => { const merged = new Map<string, Pharmacy>(); for (const result of results) if (result.status === 'fulfilled') for (const pharmacy of result.value.data.data.pharmacies as Pharmacy[]) merged.set(pharmacy._id, pharmacy); setPharmacies([...merged.values()].sort((a, b) => a.name.localeCompare(b.name))); if (results.some((result) => result.status === 'rejected')) setPharmacyNotice('Some pharmacy choices could not be loaded. You can describe the pharmacy in your message.'); }); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const { data } = await api.post('/support', { subject, category, priority, body, ...(pharmacyId ? { pharmacyId } : {}) }); onCreated(data.data.ticket); setSubject(''); setBody(''); setPharmacyId(''); setCategory('OTHER'); setPriority('NORMAL'); setMessage('Ticket created. You can follow the conversation below.'); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <details className="support-create"><summary>Create a support ticket</summary><form className="support-create-form" onSubmit={(e) => void submit(e)}><Field label="Subject" required minLength={5} maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)}/><div className="support-form-grid"><label className="field"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label><label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)}>{priorities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label><label className="field"><span>Pharmacy (optional)</span><select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}><option value="">Not associated with a pharmacy</option>{pharmacies.map((pharmacy) => <option key={pharmacy._id} value={pharmacy._id}>{pharmacy.name}{pharmacy.isDemo ? ' - DEMO' : ''} {pharmacy.city ? `- ${pharmacy.city}` : ''}</option>)}</select><small>Shows your assigned pharmacies and up to 50 participating pharmacies.</small></label></div>{pharmacyNotice && <p className="team-note">{pharmacyNotice}</p>}<label className="field"><span>Message</span><textarea required minLength={5} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}/><small>Please avoid including medical or prescription details.</small></label>{error && <div className="inline-error" role="alert">{error}</div>}{message && <p className="inline-success" role="status">{message}</p>}<Button disabled={busy}>{busy ? 'Creating...' : 'Create ticket'}</Button></form></details>;
}

function TicketDetail({ ticket, manager, agents, onUpdated, onReload }: { ticket: Ticket; manager: boolean; agents: Person[] | null; onUpdated: (ticket: Ticket) => void; onReload: () => void }) {
  const { user } = useAuth(); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const requesterIsUser = ticket.requesterId?._id === user?.id; const mayReply = !manager || requesterIsUser || !['RESOLVED', 'CLOSED'].includes(ticket.status);
  async function reply(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const { data } = await api.post(`/support/${ticket._id}/comments`, { body }); setBody(''); onUpdated(data.data.ticket); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <section><div className="support-detail-header"><div><div className="eyebrow">{label(ticket.category)} - {label(ticket.priority)} priority</div><h2>{ticket.subject}</h2><p>{ticket.requesterId?.name || 'Account unavailable'}{ticket.pharmacyId ? ` - ${ticket.pharmacyId.name}` : ''}</p></div><StatusPill>{label(ticket.status)}</StatusPill></div>
    <Button type="button" className="button-outline button-small" onClick={onReload}>Refresh ticket</Button><p className="support-meta">Assigned to: {ticket.assignedTo?.name || 'Unassigned'}</p>{ticket.resolutionNotes && <p className="support-resolution"><b>Resolution:</b> {ticket.resolutionNotes}</p>}
    {manager && <TicketManagement ticket={ticket} agents={agents} onUpdated={onUpdated}/>}<RetentionHoldControl ticket={ticket} onReload={onReload}/>
    <h3>Conversation</h3><div className="support-conversation">{ticket.comments?.map((comment, index) => <article className={`support-message ${comment.authorId?._id === user?.id ? 'support-message-own' : ''}`} key={comment._id || `${comment.at}-${index}`}><div><strong>{comment.authorId?.name || 'Account unavailable'}</strong><small>{new Date(comment.at).toLocaleString('en-IN')}</small></div><p>{comment.body}</p></article>)}</div>
    {mayReply ? <form className="support-reply" onSubmit={(e) => void reply(e)}><label className="field"><span>Reply</span><textarea required maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}/><small>A reply to a resolved or closed ticket reopens it. Do not include medical or prescription details.</small></label>{error && <div className="inline-error" role="alert">{error}</div>}<Button disabled={busy}>{busy ? 'Sending...' : 'Send reply'}</Button></form> : <p>Reopen this ticket before replying.</p>}
    {!!ticket.statusHistory?.length && <details className="verification-history"><summary>Status history</summary><ul>{[...ticket.statusHistory].reverse().map((entry, index) => <li key={entry._id || `${entry.at}-${index}`}>{label(entry.status)} - {entry.actorId?.name || 'Account unavailable'} - {new Date(entry.at).toLocaleString('en-IN')}{entry.resolutionNotes && <p>Resolution at transition: {entry.resolutionNotes}</p>}</li>)}</ul></details>}
  </section>;
}

function RetentionHoldControl({ ticket, onReload }: { ticket: Ticket; onReload: () => void }) {
  const { user } = useAuth(); const permitted = Boolean(user?.permissions.includes('*') || user?.permissions.includes('privacy:manage')); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const purged = Boolean(ticket.contentPurgedAt);
  if (!permitted) return null;
  async function toggle() { const hold = !ticket.retentionHold; const reason = window.prompt(`Reason to ${hold ? 'place' : 'release'} the retention hold (5–500 characters).`); if (!reason) return; setBusy(true); setError(''); try { await api.put(`/admin/retention-holds/${ticket._id}`, { hold, revision: ticket.revision ?? 0, reason }); onReload(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  return <div className="settings-actions"><span>Retention hold: {ticket.retentionHold ? 'Active' : 'None'}</span><Button type="button" className="button-outline button-small" disabled={busy || purged} onClick={() => void toggle()}>{busy ? 'Saving…' : ticket.retentionHold ? 'Release hold' : 'Place hold'}</Button>{error && <div className="inline-error" role="alert">{error}</div>}{purged && <small>Conversation content has already been purged.</small>}</div>;
}

function TicketManagement({ ticket, agents, onUpdated }: { ticket: Ticket; agents: Person[] | null; onUpdated: (ticket: Ticket) => void }) {
  const [status, setStatus] = useState(ticket.status); const [priority, setPriority] = useState(ticket.priority); const [assignedTo, setAssignedTo] = useState(ticket.assignedTo?._id || ''); const [resolutionNotes, setResolutionNotes] = useState(ticket.resolutionNotes || ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const changes: { revision: number; status?: string; priority?: string; assignedTo?: string | null; resolutionNotes?: string } = { revision: ticket.revision ?? 0 };
    if (status !== ticket.status) changes.status = status; if (priority !== ticket.priority) changes.priority = priority; if (resolutionNotes !== (ticket.resolutionNotes || '')) changes.resolutionNotes = resolutionNotes;
    if (agents && assignedTo !== (ticket.assignedTo?._id || '')) changes.assignedTo = assignedTo || null;
    if (Object.keys(changes).length === 1) { setError('Choose a change before saving.'); setBusy(false); return; }
    try { const { data } = await api.patch(`/support/${ticket._id}/status`, changes); onUpdated(data.data.ticket); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <details className="support-management"><summary>Manage ticket</summary><form onSubmit={(e) => void save(e)}><div className="support-form-grid"><label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label><label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)}>{priorities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label><label className="field"><span>Assignee</span><select value={assignedTo} disabled={!agents} onChange={(e) => setAssignedTo(e.target.value)}><option value="">Unassigned</option>{ticket.assignedTo && !agents?.some((agent) => agent._id === ticket.assignedTo?._id) && <option value={ticket.assignedTo._id}>{ticket.assignedTo.name} (unavailable)</option>}{agents?.map((agent) => <option key={agent._id} value={agent._id}>{agent.name}{agent.email ? ` - ${agent.email}` : ''}</option>)}</select>{!agents && <small>Agent list unavailable; refresh the page to change assignment.</small>}</label></div><label className="field"><span>Resolution notes</span><textarea maxLength={2000} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)}/><small>Visible to the requester; required when resolving or closing. Reopening clears the current resolution and preserves it in the history.</small></label>{error && <div className="inline-error" role="alert">{error} <small>If the ticket changed, use Refresh ticket before saving.</small></div>}<Button disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button></form></details>;
}
