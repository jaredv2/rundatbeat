export default function UploadProgress({ value = 0 }) {
  return (
    <div className="h-3 border border-rdb-border bg-rdb-bg">
      <div className="h-full bg-rdb-orange" style={{ width: `${value}%` }} />
    </div>
  );
}
