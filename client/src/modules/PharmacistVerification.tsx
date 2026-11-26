import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../services/api';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Loading, StatusPill } from '../components/ui';

type History = { _id?: string; status: string; action?: string; reason?: string; at: string };
type Pharmacy = { _id: string; name: string; city?: string };
type Profile = { _id: string; userId?: { _id: string; name: string; email?: string } | string; registrationNumber?: string; council?: string; verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'; pharmacyIds: Pharmacy[]; revision?: number; evidenceOriginalName?: string; evidenceUploadedAt?: string; reviewReason?: string; verificationHistory?: History[]; isDemo?: boolean };
type Reservation = { _id: string; status: string; quantity: number; medicineId?: { name: string; strength?: string }; pharmacyId?: { _id: string; name: string } };
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

function ReviewHistory({ history }: { history?: History[] }) {
  if (!history?.length) return <p>No review history recorded yet.</p>;
  return <details className="verification-history"><summary>Review history</summary><ul>{[...history].reverse().map((entry, index) => <li key={entry._id || `${entry.at}-${index}`}><strong>{entry.action?.replaceAll('_', ' ') || 'STATUS CHANGE'}</strong> - {entry.status} - {new Date(entry.at).toLocaleString('en-IN')}{entry.reason && <p>{entry.reason}</p>}</li>)}</ul></details>;
}

function RegistrationForm({ profile, onSaved }: { profile: Profile | null; onSaved: (value: Profile) => void }) {
  const [number, setNumber] = useState(profile?.registrationNumber || ''); const [council, setCouncil] = useState(profile?.council || '');
  const [acknowledged, setAcknowledged] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api.post('/pharmacists/application', { registrationNumber: number, council, pharmacyIds: [] }); onSaved(data.data.profile); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <form className="verification-form" onSubmit={(e) => void submit(e)}><Field label="Registration number" required minLength={3} maxLength={100} value={number} onChange={(e) => setNumber(e.target.value)}/><Field label="State Pharmacy Council" required minLength={3} maxLength={160} value={council} onChange={(e) => setCouncil(e.target.value)}/>{profile && <label className="verification-check"><input type="checkbox" required checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}/> Updating this application returns it to pending and requires a new evidence upload.</label>}{error && <div className="inline-error" role="alert">{error}</div>}<Button disabled={busy}>{busy ? 'Submitting...' : profile ? 'Submit updated application' : 'Submit registration details'}</Button></form>;
}

function EvidenceUpload({ profile, onSaved }: { profile: Profile; onSaved: (value: Profile) => void }) {
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function upload(e: FormEvent) {
    e.preventDefault(); if (!file) return; setBusy(true); setError(''); setMessage('');
    try { const body = new FormData(); body.append('document', file); const { data } = await api.post('/pharmacists/me/evidence', body, { headers: { 'Content-Type': 'multipart/form-data' } }); onSaved(data.data.profile); setFile(null); setMessage('Evidence uploaded for review.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <section className="evidence-section"><h3>Registration evidence</h3>{profile.evidenceOriginalName ? <p>Uploaded: {profile.evidenceOriginalName} <a className="text-link" href={`${apiBase}/pharmacists/me/evidence`} target="_blank" rel="noreferrer">Download your document</a></p> : <p>Upload your registration evidence before an administrator can verify your application.</p>}
    {profile.verificationStatus !== 'VERIFIED' && <form onSubmit={(e) => void upload(e)}><label className="field"><span>PDF, JPEG or PNG</span><input type="file" accept="application/pdf,image/jpeg,image/png" required onChange={(e) => setFile(e.target.files?.[0] || null)}/><small>Stored privately for verification staff. Do not upload patient prescriptions.</small></label><Button disabled={busy || !file}>{busy ? 'Uploading...' : 'Upload evidence'}</Button></form>}
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <p className="inline-success" role="status">{message}</p>}
  </section>;
}

export function PharmacistWorkspace() {
  const [profile, setProfile] = useState<Profile | null>(null); const [reservations, setReservations] = useState<Reservation[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const [p, assigned] = await Promise.all([api.get('/pharmacists/me'), api.get('/pharmacies/mine')]);
      const next: Profile | null = p.data.data.profile; setProfile(next);
      if (next?.verificationStatus !== 'VERIFIED' || !next.evidenceOriginalName || !next.evidenceUploadedAt) { setReservations([]); return; }
      const ids = new Set(next.pharmacyIds.map((pharmacy) => pharmacy._id));
      const eligible = assigned.data.data.assignments.filter((assignment: { pharmacyId: string; role: string }) => assignment.role === 'PHARMACIST' && ids.has(assignment.pharmacyId));
      const requests = await Promise.allSettled(eligible.map((assignment: { pharmacyId: string }) => api.get('/reservations', { params: { pharmacyId: assignment.pharmacyId } })));
      setReservations(requests.flatMap((row) => row.status === 'fulfilled' ? row.value.data.data.reservations as Reservation[] : []));
      if (requests.some((row) => row.status === 'rejected')) setError('Some assigned requests could not be loaded. Refresh the workspace to try again.');
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function saved(next: Profile) { setProfile(next); if (next.verificationStatus !== 'VERIFIED' || !next.evidenceOriginalName || !next.evidenceUploadedAt) setReservations([]); }
  return <div className="container page-section"><div className="dashboard-welcome"><div><div className="eyebrow">PHARMACIST WORKSPACE</div><h1>Professional review</h1><p>Manage your registration and review requests at assigned pharmacies.</p></div><Link className="button button-outline" to="/search">Find medicine</Link></div>
    {error && <div className="inline-error" role="alert">{error} <button onClick={() => void load()}>Refresh</button></div>}{loading ? <Loading/> : <>
      {!profile ? <Card><h2>Pharmacist verification</h2><p>Enter your registration details, then upload evidence for an administrator to review. An active pharmacist assignment is required.</p><RegistrationForm profile={null} onSaved={saved}/></Card> : <Card className="verification-card"><div className="card-heading"><div><h2>Registration</h2><p>{profile.registrationNumber} - {profile.council}</p></div><StatusPill tone={profile.verificationStatus === 'VERIFIED' ? 'good' : profile.verificationStatus === 'REJECTED' ? 'bad' : 'warn'}>{profile.verificationStatus}</StatusPill></div>
        {profile.reviewReason && <p className="team-note">Reviewer note: {profile.reviewReason}</p>}<p>Assigned pharmacies: {profile.pharmacyIds.map((pharmacy) => pharmacy.name).join(', ') || 'None'}</p>
        <EvidenceUpload key={`${profile._id}:${profile.revision || 0}`} profile={profile} onSaved={saved}/><details className="verification-history"><summary>Update registration details</summary><p>Submitting new details returns your application to pending, removes the current evidence and pauses professional actions until review.</p><RegistrationForm key={`${profile._id}:${profile.revision || 0}`} profile={profile} onSaved={saved}/></details><ReviewHistory history={profile.verificationHistory}/>
      </Card>}
      {profile?.verificationStatus === 'VERIFIED' && (!profile.evidenceOriginalName || !profile.evidenceUploadedAt) && <div className="inline-error">Evidence is missing from this earlier verification. Submit updated registration details and evidence for review.</div>}
      {(profile?.verificationStatus !== 'VERIFIED' || !profile.evidenceOriginalName || !profile.evidenceUploadedAt) && <div className="inline-error">Professional actions require administrator verification, registration evidence and an active pharmacy assignment.</div>}
      <Card className="dashboard-card"><h2>Assigned pharmacy requests</h2>{reservations.map((reservation) => <ReservationReview key={reservation._id} reservation={reservation} onChanged={() => void load()}/>)}{!reservations.length && <p>{profile?.verificationStatus === 'VERIFIED' && profile.evidenceOriginalName && profile.evidenceUploadedAt ? 'No assigned requests.' : 'Requests will appear after verification.'}</p>}</Card>
    </>}
  </div>;
}
function ReservationReview({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
  const [action, setAction] = useState<'CONFIRMED' | 'REJECTED' | null>(null); const [note, setNote] = useState(''); const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function update(status: string) { setBusy(true); setError(''); try { await api.patch(`/reservations/${reservation._id}/status`, { status, ...(note.trim() ? { note: note.trim() } : {}), ...(status === 'CONFIRMED' ? { reviewAttestation: { stockReviewed: true, prescriptionRequirementsReviewed: true } } : {}) }); onChanged(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <div className="pharmacist-reservation verification-request"><div><b>{reservation.medicineId?.name} {reservation.medicineId?.strength} x {reservation.quantity}</b><small>{reservation.pharmacyId?.name} - {reservation.status.replaceAll('_', ' ')}</small></div>
    {reservation.status === 'PENDING' && !action && <div className="team-actions"><Button type="button" className="button-outline button-small" onClick={() => setAction('CONFIRMED')}>Review and confirm</Button><Button type="button" className="button-outline button-small" onClick={() => setAction('REJECTED')}>Reject</Button></div>}
    {action && <form className="verification-form" onSubmit={(e) => { e.preventDefault(); void update(action); }}><label className="field"><span>{action === 'REJECTED' ? 'Reason for rejection' : 'Review note'}</span><textarea required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}/><small>Do not enter patient health information or prescription details.</small></label>{action === 'CONFIRMED' && <label className="verification-check"><input type="checkbox" required checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}/> I have reviewed stock and applicable prescription requirements with the pharmacy.</label>}<div className="team-actions"><Button disabled={busy}>{action === 'CONFIRMED' ? 'Confirm request' : 'Reject request'}</Button><Button type="button" className="button-outline" onClick={() => setAction(null)}>Cancel</Button></div></form>}
    {reservation.status === 'CONFIRMED' && <Button type="button" className="button-outline button-small" disabled={busy} onClick={() => void update('READY_FOR_PICKUP')}>Mark ready</Button>}
    {reservation.status === 'READY_FOR_PICKUP' && <Button type="button" className="button-outline button-small" disabled={busy} onClick={() => void update('COLLECTED')}>Mark collected</Button>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </div>;
}

export function PharmacistAdminPage() {
  const { user } = useAuth(); const [profiles, setProfiles] = useState<Profile[]>([]); const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); setError(''); try { const { data } = await api.get('/pharmacists', { params: status ? { status } : {} }); setProfiles(data.data.profiles); } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [status]);
  return <div className="container page-section"><div className="dashboard-welcome"><div><div className="eyebrow">ADMIN REVIEW</div><h1>Pharmacist verification</h1><p>Review registration evidence and record your decision.</p></div><label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select></label></div>
    {error && <div className="inline-error" role="alert">{error} <button onClick={() => void load()}>Refresh</button></div>}{loading ? <Loading/> : profiles.length ? <div className="verification-grid">{profiles.map((profile) => <AdminReview key={`${profile._id}:${profile.revision || 0}`} profile={profile} own={typeof profile.userId === 'object' && profile.userId?._id === user?.id} onChanged={() => void load()}/>)}</div> : <Card><p>No pharmacist applications.</p></Card>}
  </div>;
}
function AdminReview({ profile, own, onChanged }: { profile: Profile; own: boolean; onChanged: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const applicant = typeof profile.userId === 'object' ? profile.userId : undefined;
  async function update(status: 'VERIFIED' | 'REJECTED' | 'PENDING') { if (status === 'REJECTED' && !reason.trim()) { setError('Enter a reason before rejecting or revoking verification.'); return; } setBusy(true); setError(''); try { await api.patch(`/pharmacists/${profile._id}/verification`, { status, revision: profile.revision ?? 0, reason: reason.trim() || undefined }); onChanged(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <Card className="verification-card"><div className="card-heading"><div><h2>{applicant?.name || 'Account unavailable'}</h2><p>{applicant?.email}</p></div><StatusPill tone={profile.verificationStatus === 'VERIFIED' ? 'good' : profile.verificationStatus === 'REJECTED' ? 'bad' : 'warn'}>{profile.verificationStatus}</StatusPill></div>
    <p><b>Registration:</b> {profile.registrationNumber} <br/><b>Council:</b> {profile.council}</p><p><b>Assigned:</b> {profile.pharmacyIds.map((pharmacy) => pharmacy.name).join(', ') || 'None'}</p>
    {profile.isDemo && <p className="team-note">Demo application</p>}{profile.evidenceOriginalName ? <p><a className="text-link" href={`${apiBase}/pharmacists/${profile._id}/evidence`} target="_blank" rel="noreferrer">Download registration evidence</a></p> : <p className="inline-error">No evidence uploaded.</p>}
    {own && <p className="inline-error">A different administrator must review your application.</p>}
    <label className="field"><span>Reviewer note (required for rejection or revocation)</span><textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)}/></label>
    {error && <div className="inline-error" role="alert">{error}</div>}<div className="team-actions">{profile.verificationStatus === 'PENDING' && <Button type="button" disabled={busy || own || !profile.evidenceOriginalName} onClick={() => void update('VERIFIED')}>Verify</Button>}{profile.verificationStatus !== 'REJECTED' && <Button type="button" className="button-outline" disabled={busy || own} onClick={() => void update('REJECTED')}>{profile.verificationStatus === 'VERIFIED' ? 'Revoke verification' : 'Reject'}</Button>}{profile.verificationStatus === 'REJECTED' && <Button type="button" className="button-outline" disabled={busy || own} onClick={() => void update('PENDING')}>Return to pending</Button>}</div><ReviewHistory history={profile.verificationHistory}/>
  </Card>;
}
