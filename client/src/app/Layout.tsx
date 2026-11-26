import { Link, NavLink, Outlet } from 'react-router-dom';
import { Bell, HeartPulse, LogOut, ShieldCheck, Store, UserRound } from 'lucide-react';
import { useAuth } from './AuthContext';

export function Layout() {
  const { user, signOut } = useAuth();
  const role = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'PHARMACY_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'].find((value) => user?.roles.includes(value));
  const can = (permission: string) => Boolean(user?.permissions?.includes('*') || user?.permissions?.includes(permission));

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark"><HeartPulse size={20} /></span>
          <span>medfind<span className="brand-dot">.</span></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/search">Find medicine</NavLink>
          <a href="/#how-it-works">How it works</a>
          <a href="/#for-pharmacies">For pharmacies</a>
        </nav>
        <div className="top-actions">
          {user ? <>
            <Link className="icon-link" to="/notifications" aria-label="Notifications"><Bell size={18} /></Link>
            <Link className="icon-link" to="/profile" aria-label="Profile settings"><UserRound size={18} /></Link>
            <Link className="user-chip" to="/workspace"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name.split(' ')[0]}</span></Link>
            <button className="plain-icon" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={17} /></button>
          </> : <>
            <Link className="text-link" to="/login">Log in</Link>
            <Link className="button button-small" to="/register">Create account</Link>
          </>}
        </div>
      </header>

      {user && role && <div className="workspace-strip">
        <nav className="workspace-links" aria-label="Workspace navigation">
          <span className="workspace-label">WORKSPACE</span>
          {['SUPER_ADMIN', 'ADMIN'].includes(role) ? <>
            <NavLink to="/admin" end><ShieldCheck size={15} />Administration</NavLink>
            {can('pharmacy:review') && <NavLink to="/admin/pharmacies"><Store size={15} />Pharmacies</NavLink>}
            {can('pharmacist:review') && <NavLink to="/admin/pharmacists"><UserRound size={15} />Pharmacists</NavLink>}
            {can('reservation:read:any') && <NavLink to="/admin/reservations"><ShieldCheck size={15} />Reservations</NavLink>}
            {can('report:read') && <NavLink to="/admin/reports"><ShieldCheck size={15} />Reports</NavLink>}
            {can('medicine:manage') && <NavLink to="/admin/catalogue"><Store size={15} />Catalogue</NavLink>}
            {can('audit:read') && <NavLink to="/admin/audit"><ShieldCheck size={15} />Audit history</NavLink>}
            {can('user:read') && <NavLink to="/admin/users"><UserRound size={15} />User access</NavLink>}
            {can('support:manage') && <NavLink to="/support/inbox"><Store size={15} />Support inbox</NavLink>}
            {role === 'SUPER_ADMIN' && <>
              <NavLink to="/admin/access"><ShieldCheck size={15} />Roles</NavLink>
              <NavLink to="/admin/privacy"><ShieldCheck size={15} />Privacy requests</NavLink>
              <NavLink to="/admin/operations"><ShieldCheck size={15} />Operations</NavLink>
              <NavLink to="/admin/settings"><ShieldCheck size={15} />Settings</NavLink>
            </>}
          </> : role === 'SUPPORT_ADMIN' ? (
            can('support:manage') && <NavLink to="/support/inbox"><Store size={15} />Support inbox</NavLink>
          ) : role === 'PHARMACIST' ? <>
            <NavLink to="/pharmacist"><UserRound size={15} />Pharmacist</NavLink>
            <NavLink to="/pharmacy"><Store size={15} />Pharmacy</NavLink>
          </> : role.startsWith('PHARMACY') ? (
            <NavLink to="/pharmacy"><Store size={15} />Pharmacy</NavLink>
          ) : <NavLink to="/dashboard"><UserRound size={15} />My MedFind</NavLink>}
          {role !== 'PHARMACIST' && user.roles.includes('PHARMACIST') && <NavLink to="/pharmacist"><UserRound size={15} />Pharmacist</NavLink>}
          {user.roles.some((value) => ['PHARMACY_OWNER', 'PHARMACY_STAFF', 'PHARMACIST'].includes(value)) && <NavLink to="/pharmacy/reports"><Store size={15} />Pharmacy reports</NavLink>}
          {user.roles.includes('PHARMACY_OWNER') && can('staff:manage:own') && <NavLink to="/pharmacy/team"><UserRound size={15} />Team</NavLink>}
        </nav>
      </div>}

      {user && !user.emailVerifiedAt && <div className="verification-banner">Your email is not verified. <Link to="/verify-email">Verify your email</Link></div>}
      <main><Outlet /></main>
      <footer className="footer">
        <div className="footer-inner">
          <Link className="brand" to="/"><span className="brand-mark"><HeartPulse size={18} /></span><span>medfind<span className="brand-dot">.</span></span></Link>
          <p>Helping you find nearby pharmacies that report medicine availability.</p>
          <div className="footer-links"><Link to="/about">About</Link><Link to="/contact">Contact</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/support">Support</Link></div>
          <small>Availability is reported by pharmacies and should be confirmed directly before travel.</small>
        </div>
      </footer>
    </div>
  );
}
