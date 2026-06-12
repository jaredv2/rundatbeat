export default function Footer() {
  return (
    <footer className="site-footer border-t border-rdb-border bg-rdb-bg px-3 py-4">
      <div className="mx-auto flex max-w-[860px] flex-col gap-2 font-mono text-[10px] uppercase text-rdb-muted md:flex-row md:items-center md:justify-between">
        <span className="text-rdb-orange">RUNDATBEAT</span>
        <a className="hover:text-rdb-orange" href="https://discord.gg/2PNx4ad29x" target="_blank" rel="noreferrer">DISCORD</a>
        <span>v0.5.0</span>
      </div>
    </footer>
  );
}
