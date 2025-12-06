export default function StatCard({ icon, value, label, iconBg, progress }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={iconBg ? { background: iconBg } : undefined}>
        {icon}
      </div>
      <div className="stat-info">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
      {progress !== undefined && (
        <div className="stat-progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
