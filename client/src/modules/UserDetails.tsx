import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Loading, StatusPill } from '../components/ui';
import { accessAdministration, type UserDetails } from '../services/accessAdministration';
import { errorMessage } from '../services/api';

export function UserDetailsPage() {
  const { id = '' } = useParams(); const { user } = useAuth(); const can = (permission: string) => Boolean(user?.permissions?.includes('*') || user?.permissions?.includes(permission));
  const [data, setData] = useState<UserDetails | null>(null); const [page, setPage] = useState(1); const [reload, setReload] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const permitted = can('user:read'); const permissionsKey = user?.permissions?.join(',');
  useEffect(() => { setPage(1); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null);
    if (!permitted) { setLoading(false); return; }
    if (!/^[0-9a-f]{24}$/i.test(id)) { setError('Invalid account link.'); setLoading(false); return; }
    setLoading(true); void accessAdministration.user(id, page, controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, reload, permitted, permissionsKey]);
  return <div className="container page-section"><div className="page-intro"><div className="eyebrow">ADMINISTRATION</div><h1>Account details</h1><p>Review account identity, access roles and authorized pharmacy assignments.</p><Link to="/admin/users">Back to user access</Link></div>
    {!permitted ? <Card><p>Your current policy does not allow the user directory.</p></Card> : loading ? <Loading/> : error ? <Card><div className="inline-error" role="alert">{error}</div><Button type="button" onClick={() => setReload((value) => value + 1)}>Reload account</Button></Card> : data && <>
      <Card className="settings-card"><div className="card-heading"><h2>{data.user.name}</h2><StatusPill tone={data.user.active ? 'good' : 'warn'}>{data.user.active ? 'Active' : 'Suspended'}</StatusPill></div>{data.user.isDemo && <p><b>DEMO DATA</b></p>}
        <dl className="medicine-identity">{[['Account ID', data.user._id], ['Email', data.user.email || 'Not recorded'], ['Phone', data.user.phone || 'Not recorded'], ['Roles', data.user.roles.join(', ')], ['Email verified', data.user.emailVerifiedAt ? new Date(data.user.emailVerifiedAt).toLocaleString('en-IN') : 'Not verified'], ['Registered', data.user.createdAt ? new Date(data.user.createdAt).toLocaleString('en-IN') : 'Not recorded'], ['Account record updated', data.user.updatedAt ? new Date(data.user.updatedAt).toLocaleString('en-IN') : 'Not recorded'], ['Access revision', String(data.user.accessRevision ?? 0)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="report-note">Private locations, medicine searches, support conversations and authentication credentials are excluded from this account view.</p>
        {can('audit:read') && <div className="settings-actions"><Link className="button button-outline" to={`/admin/audit?actorId=${data.user._id}`}>Actions performed by this account</Link>{can('audit:read:security') && <Link className="button button-outline" to={`/admin/audit?resourceType=User&resourceId=${data.user._id}`}>Events about this account</Link>}</div>}
      </Card><Card className="settings-card"><h2>Pharmacy assignments</h2>{data.assignments === null ? <p>Pharmacy review or management permission is required to view assignments.</p> : <><div className="table-wrap"><table><thead><tr><th>Pharmacy</th><th>Role</th><th>Assignment permissions</th><th>Status</th></tr></thead><tbody>{data.assignments.map((assignment) => <tr key={assignment._id}><td>{assignment.pharmacyId?.name || 'Pharmacy no longer recorded'}<small>{assignment.pharmacyId?.city}</small>{assignment.pharmacyId && can('audit:read') && <Link to={`/admin/audit?pharmacyId=${assignment.pharmacyId._id}`}>Pharmacy audit activity</Link>}</td><td>{assignment.role}</td><td>{assignment.permissions.join(', ') || 'Role and verification checks'}</td><td>{assignment.active ? 'Active' : 'Revoked'}</td></tr>)}</tbody></table></div>{!data.assignments.length && <p>No assignments on this page.</p>}<div className="support-pagination"><Button type="button" className="button-outline button-small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} · {data.assignmentTotal} assignments (including revoked)</span><Button type="button" className="button-outline button-small" disabled={page * data.limit >= (data.assignmentTotal || 0)} onClick={() => setPage((value) => value + 1)}>Next</Button></div></>}
      </Card>
    </>}
  </div>;
}
