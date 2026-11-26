import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { catalogue, type PublicMedicine } from '../services/catalogue';
import { errorMessage } from '../services/api';
import { Button, Card, Loading, StatusPill } from '../components/ui';

export function MedicineDetailsPage() {
  const { id = '' } = useParams(); const [medicine, setMedicine] = useState<PublicMedicine | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setMedicine(null); setError('');
    if (!/^[0-9a-f]{24}$/i.test(id)) { setError('This medicine link is invalid.'); setLoading(false); return; }
    setLoading(true); void catalogue.publicMedicine(id, controller.signal).then((value) => { if (!controller.signal.aborted) setMedicine(value); }).catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  return <div className="container page-section medicine-details"><div className="page-intro"><div className="eyebrow">MEDICINE CATALOGUE</div><h1>{medicine?.name || 'Medicine details'}</h1><p>Check the exact strength, form and pack before contacting a pharmacy.</p><Link to="/search">Back to medicine search</Link></div>
    {loading ? <Loading/> : error ? <Card><div className="inline-error" role="alert">{error}</div><Button type="button" onClick={() => setReload((value) => value + 1)}>Retry</Button></Card> : medicine && <>
      {medicine.isDemo && <div className="support-update-notice"><b>DEMO DATA.</b> This is a sample catalogue entry.</div>}
      <Card className="settings-card"><h2>Product identity</h2><dl className="medicine-identity">{[['Medicine name', medicine.name], ['Brand', medicine.brand], ['Generic name', medicine.genericName], ['Composition', medicine.composition], ['Strength', medicine.strength], ['Dosage form', medicine.dosageForm], ['Manufacturer', medicine.manufacturer], ['Pack size', medicine.packSize]].map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl>
        {medicine.aliases.length > 0 && <p><b>Catalogue aliases:</b> {medicine.aliases.join(', ')}</p>}{medicine.categories.length > 0 && <p><b>Categories:</b> {medicine.categories.map((category) => category.name).join(', ')}</p>}
      </Card><Card className="settings-card"><h2>Prescription classification</h2><StatusPill tone={medicine.classificationVerified ? 'good' : 'warn'}>{medicine.classificationVerified ? medicine.prescriptionClass : 'UNVERIFIED'}</StatusPill>
        {medicine.classificationVerified ? <><p>Recorded source: {medicine.classificationSource}</p>{medicine.classificationReviewedAt && <p>Catalogue reviewed on {new Date(medicine.classificationReviewedAt).toLocaleDateString('en-IN')}.</p>}</> : <p>A classification has not been verified in this catalogue.</p>}
        <p>The licensed pharmacy confirms applicable prescription and dispensing requirements. This page provides catalogue information and does not recommend treatment or substitutions.</p>
      </Card><Card className="settings-card"><h2>Availability at participating pharmacies</h2><p>Availability is reported by pharmacies. Review the update time and confirm directly before travelling.</p><Link className="button" to={`/search?medicineId=${medicine._id}`}>Find this exact medicine</Link></Card>
    </>}
  </div>;
}
