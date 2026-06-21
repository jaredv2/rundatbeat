import { ExternalLink } from 'lucide-react';

const IG_SVG = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

const X_SVG = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const BETA_TESTERS = [
  { name: 'LOUIS', ig: 'ssl.w_', x: 'ss_lw_' },
  { name: 'LILRISHGI', ig: 'lilrishgi', x: 'lilrishgi' },
];

function SocialLink({ href, icon, label }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rdb-button flex items-center gap-2"
    >
      {icon}
      {label}
      <ExternalLink size={12} />
    </a>
  );
}

export default function Credits() {
  return (
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-6">
      <div className="mx-auto w-full max-w-md space-y-6 text-center">
        <div className="rdb-panel p-8 space-y-6">
          <h1 className="font-mono text-3xl font-bold uppercase text-rdb-orange">CREDITS</h1>

          {/* Creator card */}
          <div className="space-y-4">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/50 p-5">
              <p className="font-mono text-[10px] uppercase text-rdb-muted mb-3">CREATOR</p>
              <p className="font-mono text-lg font-bold uppercase text-rdb-text">CHRIS</p>
            </div>
            <div className="flex gap-3 justify-center">
              <SocialLink href="https://instagram.com/2twochris" icon={IG_SVG} label="Instagram" />
              <SocialLink href="https://x.com/2christaken" icon={X_SVG} label="Twitter" />
            </div>
          </div>

          {/* Beta testers grid */}
          <div>
            <p className="font-mono text-[10px] uppercase text-rdb-muted mb-3">BETA TESTERS</p>
            <div className="grid grid-cols-2 gap-3">
              {BETA_TESTERS.map((t) => (
                <div key={t.name} className="rounded-lg border border-rdb-border bg-rdb-bg/50 p-4 space-y-3">
                  <p className="font-mono text-sm font-bold uppercase text-rdb-text">{t.name}</p>
                  <div className="flex flex-col gap-2">
                    <SocialLink href={`https://instagram.com/${t.ig}`} icon={IG_SVG} label={`@${t.ig}`} />
                    <SocialLink href={`https://x.com/${t.x}`} icon={X_SVG} label={`@${t.x}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
