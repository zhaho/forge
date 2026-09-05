// Formats the seconds between two ISO/SQLite datetime strings as e.g. "45s", "3m 12s", "1h 5m".
function toDate(value) {
  // Steps store full ISO timestamps (new Date().toISOString()); SQLite's
  // datetime('now') returns "YYYY-MM-DD HH:MM:SS" UTC with no timezone marker.
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return null;
  const start = toDate(startedAt);
  const end = finishedAt ? toDate(finishedAt) : new Date();
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Renders an ISO/SQLite datetime as "YYYY-MM-DD HH:MM:SS" UTC, matching the
// plain SQLite datetime('now') strings shown elsewhere (e.g. created_at).
function formatTimestamp(value) {
  if (!value) return null;
  const date = toDate(value);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

module.exports = { formatDuration, formatTimestamp };
