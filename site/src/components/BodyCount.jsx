const MIN = 1000, MAX = 20000, STEP = 1000;

export default function BodyCount({ value, onChange, stats }) {
  const slow = stats && stats.speed < 0.85; // the worker is not keeping up with real time
  return (
    <div className="bodycount">
      <label>
        <span className="bodycount-value">{value.toLocaleString()} bodies</span>
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Number of bodies"
        />
      </label>
      {stats && (
        <span className="bodycount-stats" title={`renderer: ${stats.renderer}`}>
          {Math.round(stats.fps)} fps · {stats.stepsPerSecond} steps/s · {stats.stepMs.toFixed(1)} ms{slow ? ` · sim at ${Math.round(stats.speed * 100)}%` : ''}
        </span>
      )}
    </div>
  );
}
