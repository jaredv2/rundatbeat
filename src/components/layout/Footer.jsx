export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-rdb-border bg-rdb-bg px-4 py-4">
      <div className="mx-auto flex max-w-[800px] flex-col items-center gap-2 font-mono text-xs uppercase text-rdb-muted sm:flex-row sm:justify-between">
        <span className="text-rdb-orange">SAMPLE BATTLE</span>
        <a className="hover:text-rdb-orange transition-colors" href="https://discord.gg/2PNx4ad29x" target="_blank" rel="noreferrer">Discord</a>
        <span>v0.5.0</span>
      </div>
    </footer>
  );
}
