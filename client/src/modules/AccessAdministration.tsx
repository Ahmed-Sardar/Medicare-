import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Loading, StatusPill } from '../components/ui';
import { accessAdministration, roleCodes, type AccessUser, type RolePolicy } from '../services/accessAdministration';
import { errorMessage } from '../services/api';

const label = (value: string) => value.replaceAll('_', ' ').replaceAll(':', ' / ').toLowerCase();
const has = (permissions: string[] | undefined, permission: string) => Boolean(permissions?.includes('*') || permissions?.includes(permission));

export function UserAdministrationPage() {
  const { user } = useAuth(); const [query, setQuery] = useState(''); const [submitted, setSubmitted] = useState(''); const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AccessUser[]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selected, setSelected] = useState<AccessUser | null>(null); const [reload, setReload] = useState(0); const [message, setMessage] = useState('');
  const superAdmin = Boolean(user?.roles.includes('SUPER_ADMIN')); const canRead = has(user?.permissions, 'user:read');
  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    void accessAdministration.users(submitted, page, controller.signal).then((data) => { if (!controller.signal.aborted) { setUsers(data.users); setTotal(data.total); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [submitted, page, reload, canRead]);
  return <div className="container page-section"><div className="page-intro"><div className="eyebrow">ADMINISTRATION</div><h1>User access</h1><p>Search accounts, assign permitted roles and manage activation.</p><Link to="/admin">Back to administration</Link></div>
    {!canRead ? <Card><p>Your current policy does not permit the user directory.</p></Card> : <>
      <form className="access-search" onSubmit={(event) => { event.preventDefault(); setSelected(null); setSubmitted(query.trim()); setPage(1); setReload((value) => value + 1); }}><Field label="Name or email" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)}/><Button disabled={loading}>Search accounts</Button></form>
      {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={() => setReload((value) => value + 1)}>Reload directory</Button></div>}{message && <div className="inline-success" role="status">{message}</div>}
      {loading ? <Loading/> : <Card className="settings-card"><div className="table-wrap"><table><thead><tr><th>Account</th><th>Roles</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map((account) => {
        const protectedAccount = !superAdmin && account.roles.some((role) => ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'].includes(role));
        const editable = !protectedAccount && account._id !== user?.id && (has(user?.permissions, 'user:manage') || has(user?.permissions, 'user:roles:manage'));
        return <tr key={account._id}><td><b><Link to={`/admin/users/${account._id}`}>{account.name}</Link></b><small>{account.email}{account.isDemo ? ' · DEMO DATA' : ''}</small></td><td>{account.roles.map(label).join(', ')}</td><td><StatusPill tone={account.active ? 'good' : 'warn'}>{account.active ? 'Active' : 'Suspended'}</StatusPill></td><td>{editable ? <Button type="button" className="button-outline button-small" onClick={() => { setSelected(account); setMessage(''); }}>Edit access</Button> : <small>{account._id === user?.id ? 'Another administrator must change your access' : protectedAccount ? 'Super administrator required' : 'Read only'}</small>}</td></tr>;
      })}</tbody></table></div>{!users.length && <p>No accounts match this search.</p>}<div className="support-pagination"><Button type="button" className="button-outline button-small" disabled={page <= 1} onClick={() => { setSelected(null); setPage((value) => value - 1); }}>Previous</Button><span>Page {page} · {total} accounts</span><Button type="button" className="button-outline button-small" disabled={page * 25 >= total} onClick={() => { setSelected(null); setPage((value) => value + 1); }}>Next</Button></div></Card>}
      {selected && <UserAccessEditor key={`${selected._id}-${selected.accessRevision ?? 0}`} account={selected} canEditRoles={has(user?.permissions, 'user:roles:manage')} canEditActive={has(user?.permissions, 'user:manage')} superAdmin={superAdmin}
        onClose={() => setSelected(null)} onReload={() => { setSelected(null); setReload((value) => value + 1); }} onSaved={() => { setSelected(null); setMessage('Account access updated. Changed accounts must sign in again.'); setReload((value) => value + 1); }}/>}</>}
  </div>;
}

function UserAccessEditor({ account, canEditRoles, canEditActive, superAdmin, onClose, onReload, onSaved }: { account: AccessUser; canEditRoles: boolean; canEditActive: boolean; superAdmin: boolean; onClose: () => void; onReload: () => void; onSaved: () => void }) {
  const [roles, setRoles] = useState(account.roles); const [active, setActive] = useState(account.active); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const changedRoles = [...roles].sort().join(',') !== [...account.roles].sort().join(','); const changed = changedRoles || active !== account.active;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!changed || busy) return;
    if (!window.confirm(`Change access for ${account.name}? Their existing sessions will be revoked.`)) return;
    setBusy(true); setError('');
    try { await accessAdministration.updateUser(account, { ...(changedRoles ? { roles } : {}), ...(active !== account.active ? { active } : {}), reason: reason.trim() }); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <Card className="settings-card"><h2>Edit access for {account.name}</h2><p className="report-note">Removing an account role requires first revoking any pharmacy assignments that use it. Pharmacist roles require separate verification and a pharmacy assignment before professional actions become available.</p>
    <form onSubmit={submit}><fieldset className="settings-fieldset" disabled={busy}><div className="access-role-grid">{roleCodes.filter((role) => superAdmin || !['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'].includes(role)).map((role) => <label className="settings-checkbox" key={role}><input type="checkbox" disabled={!canEditRoles || Boolean(account.isDemo && ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'].includes(role))} checked={roles.includes(role)} onChange={(event) => setRoles((current) => event.target.checked ? [...current, role] : current.filter((value) => value !== role))}/>{label(role)}</label>)}</div>
      <label className="settings-checkbox"><input type="checkbox" disabled={!canEditActive} checked={active} onChange={(event) => setActive(event.target.checked)}/>Account is active</label>
      <Field label="Reason for this access change" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/>
      {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={() => { if (window.confirm('Discard these access edits and reload the directory?')) onReload(); }}>Reload directory</Button></div>}<div className="settings-actions"><Button disabled={!changed || roles.length === 0}>{busy ? 'Saving...' : 'Save access change'}</Button><Button type="button" className="button-outline" onClick={() => { if (!changed || window.confirm('Discard these unsaved access edits?')) onClose(); }}>Close editor</Button></div></fieldset></form>
  </Card>;
}

export function RoleAdministrationPage() {
  const [policies, setPolicies] = useState<RolePolicy[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); void accessAdministration.roles(controller.signal).then((roles) => { if (!controller.signal.aborted) setPolicies(roles); }).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [reload]);
  return <div className="container page-section"><div className="page-intro"><div className="eyebrow">SUPER ADMINISTRATION</div><h1>Roles and permissions</h1><p>Configure the actions available to each role. Pharmacy assignments and professional verification remain required.</p><Link to="/admin/users">Manage account roles</Link></div>
    {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={() => setReload((value) => value + 1)}>Reload policies</Button></div>}
    {message && <div className="inline-success" role="status">{message}</div>}{loading ? <Loading/> : policies.map((policy) => <RolePolicyEditor key={`${policy.code}-${policy.revision}`} policy={policy} onSaved={(result) => { setPolicies((current) => current.map((entry) => entry.code === policy.code ? { ...entry, ...result } : entry)); setMessage(`Permissions saved for ${label(policy.code)}.`); }} onReload={() => { if (window.confirm('Reload all policies and discard any unsaved policy edits?')) setReload((value) => value + 1); }}/>)}
  </div>;
}

function RolePolicyEditor({ policy, onSaved, onReload }: { policy: RolePolicy; onSaved: (result: { permissions: string[]; revision: number }) => void; onReload: () => void }) {
  const [permissions, setPermissions] = useState(policy.permissions); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const changed = [...permissions].sort().join(',') !== [...policy.permissions].sort().join(',');
  async function save(event: FormEvent) {
    event.preventDefault(); if (!changed || busy) return;
    if (!window.confirm(`Apply this policy to every ${label(policy.code)} account? New API requests will use these permissions.`)) return;
    setBusy(true); setError('');
    try { const result = await accessAdministration.saveRole(policy, permissions, reason.trim()); onSaved(result); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <Card className="settings-card"><h2>{label(policy.code)}</h2>{policy.immutable ? <p>Full platform authority. This policy is fixed so administration remains recoverable.</p> : <form onSubmit={save}><fieldset className="settings-fieldset" disabled={busy}>
    <div className="access-permission-grid">{policy.allowedPermissions.map((permission) => <label className="settings-checkbox" key={permission}><input type="checkbox" checked={permissions.includes(permission)} disabled={policy.fixedPermissions.includes(permission)} onChange={(event) => { setPermissions((current) => event.target.checked ? [...current, permission] : current.filter((value) => value !== permission)); }}/><span>{label(permission)}{policy.fixedPermissions.includes(permission) ? ' (required)' : ''}</span></label>)}</div>
    <Field label="Reason for policy change" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/>{error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={onReload}>Reload policies</Button></div>}
    <div className="settings-actions"><Button disabled={!changed}>{busy ? 'Saving...' : 'Save role policy'}</Button><Button type="button" className="button-outline" onClick={() => setPermissions(policy.defaultPermissions)}>Use default permissions</Button></div></fieldset></form>}
  </Card>;
}
