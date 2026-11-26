import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { api, errorMessage } from '../services/api';
import { Button, Card, Loading, StatusPill } from '../components/ui';

const permissionOptions = [
  ['inventory:read', 'View inventory'], ['inventory:update', 'Add and correct stock'],
  ['reservation:read', 'View reservations'], ['report:read', 'View and export reports'],
] as const;
const formSchema = z.object({
  email: z.string().trim().email('Enter the account email'),
  role: z.enum(['PHARMACY_STAFF', 'PHARMACIST']),
  permissions: z.array(z.enum(['inventory:read', 'inventory:update', 'reservation:read', 'report:read'])),
});
type AccessValues = z.infer<typeof formSchema>;
type Member = { _id: string; userId: { name: string; email?: string; active: boolean } | null; role: string; permissions: string[]; active: boolean };
type Pharmacy = { _id: string; name: string };
type Mine = { pharmacies: Pharmacy[]; assignments: Array<{ pharmacyId: string; role: string }> };
const defaultValues: AccessValues = { email: '', role: 'PHARMACY_STAFF', permissions: ['inventory:read'] };

export function PharmacyTeamPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState('');
  const mine = useQuery({ queryKey: ['team', user?.id, 'owned-pharmacies'], queryFn: async () => (await api.get('/pharmacies/mine')).data.data as Mine });
  const owned = mine.data?.pharmacies.filter((p) => mine.data?.assignments.some((a) => a.pharmacyId === p._id && a.role === 'PHARMACY_OWNER')) || [];
  const current = owned.find((p) => p._id === selected) || owned[0];
  return <div className="container page-section">
    <div className="dashboard-welcome"><div><div className="eyebrow">PHARMACY TEAM</div><h1>People and access</h1><p>Manage access to your pharmacy's stock, reservations and reports.</p></div><Link className="button button-outline" to="/pharmacy">Pharmacy workspace</Link></div>
    {mine.isPending ? <Loading/> : mine.isError ? <div className="inline-error" role="alert">{errorMessage(mine.error)} <button onClick={() => void mine.refetch()}>Try again</button></div> : !current ? <Card><h2>No owned pharmacy yet</h2><p>Create a pharmacy in your workspace before adding a team.</p></Card> : <>
      <label className="field team-pharmacy"><span>Pharmacy</span><select value={current._id} onChange={(e) => setSelected(e.target.value)}>{owned.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
      <TeamEditor key={current._id} pharmacy={current}/>
    </>}
  </div>;
}

function TeamEditor({ pharmacy }: { pharmacy: Pharmacy }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Member | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [message, setMessage] = useState('');
  const form = useForm<AccessValues>({ resolver: zodResolver(formSchema), defaultValues });
  const role = form.watch('role');
  const key = ['team', user?.id, pharmacy._id];
  const members = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/pharmacies/${pharmacy._id}/staff`)).data.data.staff as Member[] });
  const change = useMutation({
    mutationFn: async (action: { kind: 'save'; input: AccessValues; id?: string } | { kind: 'revoke'; id: string }) => {
      const base = `/pharmacies/${pharmacy._id}/staff`;
      if (action.kind === 'revoke') await api.delete(`${base}/${action.id}`);
      else if (action.id) await api.patch(`${base}/${action.id}`, action.input);
      else await api.post(base, action.input);
    },
    onSuccess: async (_data, action) => {
      setMessage(action.kind === 'revoke' ? 'Pharmacy access removed.' : 'Team access saved. The member can refresh their account to see their workspace.');
      setEditing(null); setRestoring(false); setRemoving(null); form.reset(defaultValues);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  function edit(member: Member) {
    change.reset(); setMessage(''); setRemoving(null); setEditing(member.active ? member : null); setRestoring(!member.active);
    form.reset({ email: member.userId?.email || '', role: member.role === 'PHARMACIST' ? 'PHARMACIST' : 'PHARMACY_STAFF', permissions: permissionOptions.filter(([permission]) => member.permissions.includes(permission)).map(([permission]) => permission) });
  }
  function cancel() { setEditing(null); setRestoring(false); form.reset(defaultValues); change.reset(); }
  return <div className="team-layout">
    <Card className="team-form"><h2>{editing ? 'Edit access' : restoring ? 'Restore access' : 'Add a team member'}</h2><p>Add an existing MedFind account by email. Access applies only to {pharmacy.name}.</p>
      <form onSubmit={form.handleSubmit((input) => change.mutate({ kind: 'save', input, id: editing?._id }))}>
        <fieldset disabled={change.isPending}>
          <label className="field"><span>Account email</span><input type="email" autoComplete="email" readOnly={Boolean(editing) || restoring} {...form.register('email')} aria-invalid={Boolean(form.formState.errors.email)} aria-describedby={form.formState.errors.email ? 'team-email-error' : undefined}/></label>
          {form.formState.errors.email && <p id="team-email-error" className="inline-error" role="alert">{form.formState.errors.email.message}</p>}
          <label className="field"><span>Role</span><select {...form.register('role')}><option value="PHARMACY_STAFF">Pharmacy staff</option><option value="PHARMACIST">Pharmacist</option></select></label>
          {role === 'PHARMACY_STAFF' ? <fieldset className="team-permissions"><legend>Allowed actions</legend>{permissionOptions.map(([value, label]) => <label key={value}><input type="checkbox" value={value} {...form.register('permissions')}/><span>{label}</span></label>)}<small>Staff can view permitted reservations. Confirmation and collection require an owner or verified assigned pharmacist.</small></fieldset> : <p className="team-note">Pharmacists can view inventory. Inventory updates and reservation review require administrative verification. Assigning this role does not verify a pharmacist.</p>}
          <div className="team-actions"><Button type="submit">{change.isPending ? 'Saving...' : editing ? 'Save access' : restoring ? 'Restore access' : 'Add member'}</Button>{(editing || restoring) && <Button type="button" className="button-outline" onClick={cancel}>Cancel</Button>}</div>
        </fieldset>
      </form>
      {change.isError && <div className="inline-error" role="alert">{errorMessage(change.error)}</div>}
      {message && <p className="inline-success" role="status">{message}</p>}
    </Card>
    <Card className="team-directory"><h2>Team members</h2>
      {members.isPending ? <Loading/> : members.isError ? <div className="inline-error" role="alert">{errorMessage(members.error)} <button onClick={() => void members.refetch()}>Try again</button></div> : <div className="team-members">{members.data?.map((member) => <article className="team-member" key={member._id}>
        <div className="team-member-heading"><div><h3>{member.userId?.name || 'Account unavailable'}</h3><p>{member.userId?.email}</p></div><StatusPill tone={member.active ? 'good' : 'neutral'}>{member.active ? 'Active assignment' : 'Access removed'}</StatusPill></div>
        <p>{member.role === 'PHARMACY_OWNER' ? 'Pharmacy owner' : member.role === 'PHARMACIST' ? 'Pharmacist (verification required for professional actions)' : 'Pharmacy staff'}</p>
        {member.userId && !member.userId.active && <p className="inline-error">This account is suspended.</p>}
        {member.role === 'PHARMACY_STAFF' && <p className="team-note">{permissionOptions.filter(([value]) => member.permissions.includes(value)).map(([, label]) => label).join(' / ') || 'No operational permissions assigned'}</p>}
        {member.role !== 'PHARMACY_OWNER' && member.userId && <div className="team-actions"><Button type="button" className="button-outline button-small" disabled={change.isPending || !member.userId.active} onClick={() => edit(member)}>{member.active ? 'Edit access' : 'Restore access'}</Button>{member.active && <Button type="button" className="button-outline button-small" disabled={change.isPending} onClick={() => { setRemoving(member); change.reset(); setMessage(''); }}>Remove access</Button>}</div>}
        {removing?._id === member._id && <div className="team-confirm" role="group" aria-label="Confirm access removal"><p>Remove {member.userId?.name} from {pharmacy.name}? Their other pharmacy assignments will remain.</p><div className="team-actions"><Button type="button" disabled={change.isPending} onClick={() => change.mutate({ kind: 'revoke', id: member._id })}>Confirm removal</Button><Button type="button" className="button-outline" disabled={change.isPending} onClick={() => setRemoving(null)}>Cancel</Button></div></div>}
      </article>)}</div>}
    </Card>
  </div>;
}
