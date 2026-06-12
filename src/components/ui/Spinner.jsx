export default function Spinner({ size = 'md', label = 'LOADING...' }) {
  const sizeClasses = {
    sm: 'h-5 w-5 border-2',
    md: 'h-8 w-8 border-[3px]',
    lg: 'h-12 w-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-rdb-border border-t-rdb-orange`}
      />
      {label && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-rdb-muted">
          {label}
          <span className="blink ml-0.5">...</span>
        </p>
      )}
    </div>
  );
}
