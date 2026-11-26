import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
export function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`button ${className}`} {...props}>{children}</button>; }
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) { return <label className="field"><span>{label}</span><input {...props} />{hint && <small>{hint}</small>}</label>; }
export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) { return <span className={`pill pill-${tone}`}>{children}</span>; }
export function Loading() { return <div className="loading" role="status">Loading…</div>; }
