import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { Button, Card, Field, Loading } from '../components/ui';
import { customerSettings, type CustomerSettings, type SavedLocation, type SearchHistoryEntry } from '../services/customerSettings';
import { errorMessage } from '../services/api';
import { PhoneVerification } from './PhoneVerification';
import { AccountDeletionRequest } from './PrivacyRequests';

type LocationDraft = SavedLocation & { key: string };
type SettingsDraft = Omit<CustomerSettings, 'locations'> & { locations: LocationDraft[] };
const draft = (settings: CustomerSettings): SettingsDraft => ({ ...settings, locations: settings.locations.map((location) => ({ ...location, key: location.id || crypto.randomUUID() })) });

export function ProfileSettingsPage() {
  const { refresh } = useAuth(); const [settings, setSettings] = useState<SettingsDraft | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void customerSettings.get(controller.signal).then((value) => { if (!controller.signal.aborted) setSettings(draft(value)); })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  function update(change: (current: SettingsDraft) => SettingsDraft) { setSettings((current) => current ? change(current) : current); setDirty(true); setMessage(''); }
  function changeLocation(key: string, fields: Partial<SavedLocation>) { update((current) => ({ ...current, locations: current.locations.map((entry) => entry.key === key ? { ...entry, ...fields } : entry) })); }
  async function reload() {
    if (dirty && !window.confirm('Discard your unsaved changes and reload settings?')) return;
    setBusy(true); setError(''); setMessage('');
    try { setSettings(draft(await customerSettings.get())); setDirty(false); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!settings || busy) return;
    for (const location of settings.locations) {
      if ((location.latitude === undefined) !== (location.longitude === undefined)) { setError(`Enter both coordinates for ${location.label || 'the saved location'}.`); return; }
      if (!location.pinCode && location.latitude === undefined) { setError(`Enter a PIN code or coordinates for ${location.label || 'the saved location'}.`); return; }
    }
    if (!settings.preferences.recordSearchHistory && !window.confirm('Save these settings and delete your recorded search history?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const value = await customerSettings.save({ ...settings, locations: settings.locations.map(({ key: _key, ...location }) => location) });
      setSettings(draft(value)); setDirty(false); setMessage('Your settings have been saved.'); await refresh();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <div className="container page-section settings-page"><div className="page-intro"><div className="eyebrow">YOUR ACCOUNT</div><h1>Profile and search settings</h1><p>Manage your contact details, saved search locations and search history.</p></div>
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <div className="inline-success" role="status">{message}</div>}
    {loading ? <Loading/> : !settings ? <Button onClick={() => void reload()} disabled={busy}>Reload settings</Button> : <form onSubmit={save}>
      <fieldset className="settings-fieldset" disabled={busy}><Card className="settings-card"><h2>Profile</h2><div className="settings-grid">
        <Field label="Name" autoComplete="name" required minLength={2} maxLength={120} value={settings.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}/>
        <Field label="Phone" type="tel" autoComplete="tel" pattern="\+?[0-9]{10,15}" value={settings.phone || ''} hint="10 to 15 digits, with an optional country prefix." onChange={(event) => update((current) => ({ ...current, phone: event.target.value || null }))}/>
        <Field label="Email" type="email" value={settings.email} readOnly hint="Your sign-in email address."/>
      </div></Card>
      <Card className="settings-card"><div className="card-heading"><h2>Saved locations</h2><Button type="button" className="button-outline button-small" disabled={settings.locations.length >= 10} onClick={() => update((current) => ({ ...current, locations: [...current.locations, { key: crypto.randomUUID(), label: '', isDefault: false }] }))}>Add location</Button></div>
        <p>Save up to 10 PIN codes or coordinate pairs. A default location is applied when you open medicine search. Your browser location is saved only when you enter its coordinates here.</p>
        {!settings.locations.length && <p className="report-note">No saved locations yet. You can search without saving one.</p>}
        {settings.locations.map((location, index) => <section className="saved-location-editor" key={location.key} aria-label={`Saved location ${index + 1}`}>
          <div className="settings-grid"><Field label="Location label" placeholder="Home or work" required maxLength={60} value={location.label} onChange={(event) => changeLocation(location.key, { label: event.target.value })}/>
            <Field label="PIN code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={location.pinCode || ''} onChange={(event) => changeLocation(location.key, { pinCode: event.target.value || undefined })}/>
            <Field label="Latitude (optional)" type="number" step="any" min={-90} max={90} value={location.latitude ?? ''} onChange={(event) => changeLocation(location.key, { latitude: event.target.value === '' ? undefined : Number(event.target.value) })}/>
            <Field label="Longitude (optional)" type="number" step="any" min={-180} max={180} value={location.longitude ?? ''} onChange={(event) => changeLocation(location.key, { longitude: event.target.value === '' ? undefined : Number(event.target.value) })}/>
          </div><div className="settings-actions"><label className="settings-checkbox"><input type="checkbox" checked={location.isDefault} onChange={(event) => update((current) => ({ ...current, locations: current.locations.map((entry) => ({ ...entry, isDefault: entry.key === location.key && event.target.checked })) }))}/>Use as my default search location</label>
            <Button type="button" className="button-outline button-small" onClick={() => update((current) => ({ ...current, locations: current.locations.filter((entry) => entry.key !== location.key) }))}>Remove location</Button></div>
        </section>)}
      </Card>
      <Card className="settings-card"><h2>Search preferences</h2><div className="settings-grid"><Field label="Default radius (km)" type="number" min={1} max={50} step={1} required value={settings.preferences.searchRadiusKm} onChange={(event) => update((current) => ({ ...current, preferences: { ...current.preferences, searchRadiusKm: Number(event.target.value) } }))}/>
        <label className="field"><span>Default results view</span><select value={settings.preferences.searchView} onChange={(event) => { const searchView = event.target.value as 'list' | 'map'; update((current) => ({ ...current, preferences: { ...current.preferences, searchView } })); }}><option value="list">List</option><option value="map">Map</option></select></label></div>
        <label className="settings-checkbox"><input type="checkbox" checked={settings.preferences.recordSearchHistory} onChange={(event) => update((current) => ({ ...current, preferences: { ...current.preferences, recordSearchHistory: event.target.checked } }))}/>Record my medicine searches in my account</label>
        <p className="report-note">Turning this off and saving deletes your recorded searches and stops future account search history. Search history can contain sensitive medicine names.</p>
      </Card><div className="settings-actions"><Button disabled={!dirty}>{busy ? 'Saving...' : 'Save settings'}</Button><Button type="button" className="button-outline" onClick={() => void reload()}>Reload saved settings</Button><Link to="/search">Find medicine</Link></div></fieldset>
    </form>}
    {settings && !dirty && <PhoneVerification savedPhone={settings.phone}/>}
    <AccountDeletionRequest/>
  </div>;
}

export function RecentSearches() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); void customerSettings.history(controller.signal).then((value) => { if (!controller.signal.aborted) setHistory(value); }).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [reload]);
  async function clear() { if (!window.confirm('Delete your recorded search history?')) return; setBusy(true); setError(''); try { await customerSettings.clearHistory(); setHistory([]); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  return <Card className="settings-card"><div className="card-heading"><h2>Recent searches</h2>{history.length > 0 && <Button type="button" className="button-outline button-small" disabled={busy || loading} onClick={() => void clear()}>{busy ? 'Clearing...' : 'Clear history'}</Button>}</div>
    {error && <div className="inline-error" role="alert">{error} <Button type="button" className="button-outline button-small" disabled={loading || busy} onClick={() => setReload((value) => value + 1)}>Reload history</Button></div>}{loading ? <Loading/> : history.length ? <ul className="recent-searches">{history.map((entry) => <li key={entry._id}><Link to={`/search?q=${encodeURIComponent(entry.query)}`}>{entry.query}</Link><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString('en-IN')}</time></li>)}</ul> : !error && <p>No recorded searches. Manage search history in <Link to="/profile">profile settings</Link>.</p>}
  </Card>;
}
