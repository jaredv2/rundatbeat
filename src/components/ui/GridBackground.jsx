export default function GridBackground({ children, className = '' }) {
  return <section className={`rdb-grid ${className}`}>{children}</section>;
}
