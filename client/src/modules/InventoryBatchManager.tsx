import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../services/api';
import { Button, Field } from '../components/ui';

type Batch = { _id: string; batchNumber: string; expiryDate: string; onHandQuantity: number; reservedQuantity: number; sellingPrice: number; mrp: number; manufacturer?: string; updatedAt?: string };
type Item = { _id: string; medicineId?: { name: string; strength?: string }; minStock: number; reorderThreshold?: number; alertsEnabled?: boolean; batches: Batch[] };
type Refresh = () => Promise<void>;

export function InventoryBatchManager({ item, canWrite, refresh }: { item: Item; canWrite: boolean; refresh: Refresh }) {
  const [threshold, setThreshold] = useState(String(item.minStock ?? 0));
  const [reorder, setReorder] = useState(String(item.reorderThreshold ?? item.minStock ?? 0)); const [alerts, setAlerts] = useState(item.alertsEnabled !== false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { setThreshold(String(item.minStock ?? 0)); setReorder(String(item.reorderThreshold ?? item.minStock ?? 0)); setAlerts(item.alertsEnabled !== false); }, [item.minStock, item.reorderThreshold, item.alertsEnabled]);
  async function saveThreshold(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api.patch(`/inventory/${item._id}/threshold`, { minStock: Number(threshold), reorderThreshold: Number(reorder), alertsEnabled: alerts }); await refresh(); setMessage('Stock alert policy saved.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <details className="batch-details"><summary>Manage batches · {item.medicineId?.name} {item.medicineId?.strength}</summary>
    <p>Only active, unexpired batches are shown here. Reserved stock is held for existing requests.</p>
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <p className="inline-success" role="status">{message}</p>}
    {canWrite ? <form className="threshold-form" onSubmit={(e) => void saveThreshold(e)}><Field label="Low-stock alert at or below" type="number" min="0" max="1000000000" step="1" required value={threshold} onChange={(e) => setThreshold(e.target.value)}/><Field label="Reorder at or below" type="number" min={Number(threshold) || 0} max="1000000000" step="1" required value={reorder} onChange={(event) => setReorder(event.target.value)}/><label className="settings-checkbox"><input type="checkbox" checked={alerts} onChange={(event) => setAlerts(event.target.checked)}/>Enable stock and freshness alerts</label><Button disabled={busy}>Save alert policy</Button></form> : <p>Low-stock threshold: {item.minStock ?? 0}</p>}
    {item.batches.length ? item.batches.map((batch) => <BatchEditor key={`${batch._id}:${batch.updatedAt || ''}`} batch={batch} canWrite={canWrite} refresh={refresh}/>) : <p>No active, unexpired batches.</p>}
  </details>;
}
function BatchEditor({ batch, canWrite, refresh }: { batch: Batch; canWrite: boolean; refresh: Refresh }) {
  const [quantity, setQuantity] = useState(String(batch.onHandQuantity)); const [note, setNote] = useState('');
  const [expiryDate, setExpiryDate] = useState(batch.expiryDate.slice(0, 10)); const [sellingPrice, setSellingPrice] = useState(String(batch.sellingPrice)); const [mrp, setMrp] = useState(String(batch.mrp)); const [manufacturer, setManufacturer] = useState(batch.manufacturer || '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function saveQuantity(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api.patch(`/inventory/batches/${batch._id}/quantity`, { quantity: Number(quantity), note }); await refresh(); setMessage('Quantity updated.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function saveDetails(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api.patch(`/inventory/batches/${batch._id}`, { expiryDate, sellingPrice: Number(sellingPrice), mrp: Number(mrp), manufacturer }); await refresh(); setMessage('Batch details updated.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <div className="batch-card"><div className="batch-heading"><strong>Batch {batch.batchNumber}</strong><span>{batch.onHandQuantity} on hand · {batch.reservedQuantity} reserved · {Math.max(0, batch.onHandQuantity - batch.reservedQuantity)} available</span></div>
    <p>Expires {batch.expiryDate.slice(0, 10)} · Selling price ₹{batch.sellingPrice.toFixed(2)} · MRP ₹{batch.mrp.toFixed(2)}{batch.manufacturer ? ` · ${batch.manufacturer}` : ''}</p>
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <p className="inline-success" role="status">{message}</p>}
    {canWrite && <details><summary>Update this batch</summary><div className="batch-edit-grid">
      <form onSubmit={(e) => void saveQuantity(e)}><h4>Correct on-hand quantity</h4><Field label="On hand" type="number" min={batch.reservedQuantity} max="1000000000" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)}/><Field label="Reason (optional)" maxLength={250} value={note} onChange={(e) => setNote(e.target.value)}/><Button disabled={busy}>Save quantity</Button><small>Quantity cannot be lower than the reserved amount.</small></form>
      <form onSubmit={(e) => void saveDetails(e)}><h4>Batch information</h4><Field label="Expiry date" type="date" required value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}/><Field label="Selling price (₹)" type="number" min="0" step="0.01" required value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)}/><Field label="MRP (₹)" type="number" min="0" step="0.01" required value={mrp} onChange={(e) => setMrp(e.target.value)}/><Field label="Manufacturer" maxLength={160} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}/><Button disabled={busy}>Save details</Button></form>
    </div></details>}
  </div>;
}

type Movement = { _id: string; type: string; quantity: number; note?: string; createdAt: string; batchId?: string };
export function InventoryMovementHistory({ pharmacyId }: { pharmacyId: string }) {
  const [rows, setRows] = useState<Movement[]>([]); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [total, setTotal] = useState(0);
  async function load(nextPage = page) { setBusy(true); setError(''); try { const { data } = await api.get('/inventory/movements', { params: { pharmacyId, page: nextPage, limit: 25 } }); setRows(data.data.movements); setTotal(data.data.total); setPage(nextPage); setLoaded(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  useEffect(() => { setRows([]); setLoaded(false); setPage(1); setTotal(0); }, [pharmacyId]);
  return <details className="batch-details" onToggle={(e) => { if (e.currentTarget.open && !loaded && !busy) void load(1); }}><summary>Stock movement history</summary><p>Stock additions, corrections, reservation holds and releases.</p>{error && <div className="inline-error" role="alert">{error}</div>}<Button type="button" className="button-outline button-small" onClick={() => void load(page)} disabled={busy}>{busy ? 'Loading…' : 'Refresh history'}</Button>{loaded && (rows.length ? <><div className="table-wrap"><table><thead><tr><th>Time</th><th>Movement</th><th>Quantity</th><th>Note</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}><td>{new Date(row.createdAt).toLocaleString('en-IN')}</td><td>{row.type.replaceAll('_', ' ')}</td><td>{row.quantity}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div><div className="support-pagination"><Button type="button" disabled={busy || page <= 1} onClick={() => void load(page - 1)}>Previous</Button><span>Page {page} · {total} movements</span><Button type="button" disabled={busy || page * 25 >= total} onClick={() => void load(page + 1)}>Next</Button></div></> : <p>No stock movements yet.</p>)}</details>;
}
