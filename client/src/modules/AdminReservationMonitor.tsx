import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import { Button, Card, Loading, StatusPill } from '../components/ui';
import { errorMessage } from '../services/api';
import { adminReservations } from '../services/adminReservations';
import './AdminReservationMonitor.css';

const statuses = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED'];

export function AdminReservationMonitorPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admin-reservations', status, page],
    queryFn: ({ signal }) => adminReservations.list(status, page, signal),
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1;

  return (
    <div className="container page-section admin-reservation-page">
      <header className="reservation-page-header">
        <div>
          <div className="eyebrow">PLATFORM OPERATIONS</div>
          <h1>Reservation monitor</h1>
          <p>Review reservation activity across MedFind. Pharmacy teams remain responsible for fulfilment decisions.</p>
        </div>
        <div className="reservation-readonly-note"><ShieldCheck size={16} aria-hidden="true" /> Read-only overview</div>
      </header>

      <Card className="admin-reservations-card">
        <div className="reservation-toolbar">
          <label className="field reservation-filter">
            <span>Filter by status</span>
            <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All reservations</option>
              {statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          {query.data && (
            <div className="reservation-count" aria-live="polite">
              <strong>{query.data.total}</strong>
              <span>{query.data.total === 1 ? 'reservation' : 'reservations'} found</span>
            </div>
          )}
        </div>

        {query.isPending ? <Loading /> : query.isError ? (
          <div className="reservation-error" role="alert">
            <p>{errorMessage(query.error)}</p>
            <Button type="button" className="button-outline" onClick={() => void query.refetch()}>Try again</Button>
          </div>
        ) : query.data.reservations.length === 0 ? (
          <div className="reservation-empty-state">
            <span className="reservation-empty-icon"><ClipboardList size={25} aria-hidden="true" /></span>
            <h2>{status ? 'No reservations with this status' : 'No reservations yet'}</h2>
            <p>{status ? 'Try another status to see matching requests.' : 'New reservation requests will appear here when customers make them.'}</p>
            {status && <Button type="button" className="button-outline" onClick={() => { setPage(1); setStatus(''); }}>Show all reservations</Button>}
          </div>
        ) : (
          <>
            <div className="table-wrap reservation-table-wrap">
              <table className="reservation-table">
                <thead><tr><th scope="col">Requested</th><th scope="col">Pharmacy</th><th scope="col">Medicine</th><th scope="col">Quantity</th><th scope="col">Status</th></tr></thead>
                <tbody>{query.data.reservations.map((reservation) => (
                  <tr key={reservation._id}>
                    <td><time dateTime={reservation.createdAt}>{new Date(reservation.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></td>
                    <td>{reservation.pharmacyId?.name || 'Unavailable'}</td>
                    <td><span className="reservation-medicine-name">{reservation.medicineId?.name || 'Unavailable'}</span>{reservation.medicineId?.strength && <small>{reservation.medicineId.strength}</small>}</td>
                    <td>{reservation.quantity}</td>
                    <td><StatusPill>{reservation.status.replaceAll('_', ' ')}</StatusPill></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <nav className="reservation-pagination" aria-label="Reservation pages">
              <Button type="button" className="button-outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <span>Page <strong>{page}</strong> of <strong>{totalPages}</strong><span className="reservation-pagination-total"> · {query.data.total} total</span></span>
              <Button type="button" className="button-outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </nav>
          </>
        )}
      </Card>
    </div>
  );
}
