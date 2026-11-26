import { useState, type FormEvent } from 'react';
import { catalogue, medicineDraft, type CatalogueMedicine, type MedicineFields, type PrescriptionClass } from '../services/catalogue';
import { Button, Card, Field } from '../components/ui';
import { errorMessage } from '../services/api';
import { CategoryChooser } from './CategoryChooser';

export function MedicineEditor({ medicine, onSaved, onClose, onReload }: { medicine?: CatalogueMedicine; onSaved: () => void; onClose: () => void; onReload: () => void }) {
  const [form, setForm] = useState(() => medicineDraft(medicine)); const [aliases, setAliases] = useState(form.aliases.join('\n')); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [dirty, setDirty] = useState(false);
  function change<T extends keyof MedicineFields>(key: T, value: MedicineFields[T]) { setForm((current) => ({ ...current, [key]: value })); setDirty(true); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (form.classificationVerified && (form.prescriptionClass === 'UNVERIFIED' || form.classificationSource.trim().length < 5)) { setError('A verified classification requires a class and source reference.'); return; }
    if (!window.confirm(`${medicine ? 'Update' : 'Create'} this catalogue entry?`)) return;
    setBusy(true); setError('');
    try { await catalogue.saveMedicine({ ...form, aliases: aliases.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }, reason.trim(), medicine); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <Card className="settings-card catalogue-editor"><h2>{medicine ? `Edit ${medicine.name}` : 'Create catalogue medicine'}</h2>
    <p className="report-note">Each entry identifies one strength, form and pack. Aliases must refer to this exact product. Create a separate entry for a different product.</p>
    {medicine?.identityLocked && <p className="support-update-notice">Stock or reservation history uses this entry. Its product identity is locked. Categories, aliases, classification review and active status can still be updated.</p>}
    <form onSubmit={save}><fieldset className="settings-fieldset" disabled={busy}><fieldset className="settings-fieldset" disabled={Boolean(medicine?.identityLocked)}><div className="settings-grid">
      <Field label="Medicine name" required minLength={2} maxLength={160} value={form.name} onChange={(event) => change('name', event.target.value)}/>
      <Field label="Brand" maxLength={160} value={form.brand} onChange={(event) => change('brand', event.target.value)}/>
      <Field label="Generic name" maxLength={200} value={form.genericName} onChange={(event) => change('genericName', event.target.value)}/>
      <Field label="Composition" maxLength={500} value={form.composition} onChange={(event) => change('composition', event.target.value)}/>
      <Field label="Strength" required maxLength={100} value={form.strength} onChange={(event) => change('strength', event.target.value)}/>
      <Field label="Dosage form" required maxLength={100} value={form.dosageForm} onChange={(event) => change('dosageForm', event.target.value)}/>
      <Field label="Manufacturer" maxLength={200} value={form.manufacturer} onChange={(event) => change('manufacturer', event.target.value)}/>
      <Field label="Pack size" maxLength={100} value={form.packSize} onChange={(event) => change('packSize', event.target.value)}/>
    </div></fieldset>
      <label className="field"><span>Aliases (one per line, up to 30)</span><textarea value={aliases} rows={4} maxLength={3650} onChange={(event) => { setAliases(event.target.value); setDirty(true); }}/></label>
      <CategoryChooser value={form.categoryIds} initial={medicine?.categories} onChange={(ids) => change('categoryIds', ids)}/>
      <section className="classification-editor"><h3>Classification review</h3><p className="report-note">Only reviewed classifications with a source reference are shown publicly. Pharmacy professionals confirm the requirements for dispensing.</p>
        <label className="field"><span>Prescription classification</span><select value={form.prescriptionClass} onChange={(event) => { change('prescriptionClass', event.target.value as PrescriptionClass); change('classificationVerified', false); }}><option value="UNVERIFIED">Unverified</option><option value="OTC">OTC</option><option value="PRESCRIPTION">Prescription</option><option value="CONTROLLED">Controlled</option></select></label>
        <Field label="Classification source reference" hint="Shown publicly when verified. Use a catalogue reference without private or patient details." maxLength={500} value={form.classificationSource} onChange={(event) => { change('classificationSource', event.target.value); change('classificationVerified', false); }}/>
        <label className="settings-checkbox"><input type="checkbox" disabled={form.prescriptionClass === 'UNVERIFIED' || Boolean(medicine?.isDemo)} checked={form.classificationVerified} onChange={(event) => change('classificationVerified', event.target.checked)}/>I reviewed this classification against the recorded source</label>
        {medicine?.classificationReviewedAt && <p className="report-note">Previous review: {new Date(medicine.classificationReviewedAt).toLocaleString('en-IN')}</p>}
      </section>
      <label className="settings-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => change('active', event.target.checked)}/>Active in the medicine catalogue</label>
      <Field label="Reason for catalogue change" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/>
      {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" onClick={() => { if (window.confirm('Discard this draft and reload the catalogue?')) onReload(); }}>Reload catalogue</Button></div>}
      <div className="settings-actions"><Button disabled={Boolean(medicine && !dirty)}>{busy ? 'Saving...' : 'Save medicine'}</Button><Button type="button" className="button-outline" onClick={() => { if (!dirty || window.confirm('Discard this medicine draft?')) onClose(); }}>Close editor</Button></div>
    </fieldset></form>
  </Card>;
}
