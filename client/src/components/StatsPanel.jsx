import { Target, BarChart2 } from 'lucide-react';

function StatBar({ label, value, color = 'blue' }) {
  const pct = Math.round(value * 100);
  const colors = { blue: 'bg-blue-500', orange: 'bg-orange-500', green: 'bg-green-500' };
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300 font-mono">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colors[color]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StatsPanel({ prediction }) {
  if (!prediction) return null;
  const { team1, team2, match } = prediction;
  const labels = {
    hltvRating: 'Rating HLTV',
    recentForm: 'Forma reciente',
    avgRating:  'Rating jugadores',
    winRate:    'Win Rate',
    h2h:        'H2H',
    mapPool:    'Map pool',
  };

  return (
    <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 mt-2">
      <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
        <BarChart2 size={14} className="text-blue-400" />
        Análisis detallado
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{team1.logo}</span>
            <span className="font-semibold text-sm">{team1.tag}</span>
          </div>
          {Object.entries(team1.scores).map(([k, v]) => (
            <StatBar key={k} label={labels[k] || k} value={v} color="blue" />
          ))}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{team2.logo}</span>
            <span className="font-semibold text-sm">{team2.tag}</span>
          </div>
          {Object.entries(team2.scores).map(([k, v]) => (
            <StatBar key={k} label={labels[k] || k} value={v} color="orange" />
          ))}
        </div>
      </div>
      {match.maps?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1e2d45]">
          <div className="text-xs text-slate-400 mb-2 flex items-center gap-1">
            <Target size={11} /> Mapas del partido
          </div>
          <div className="flex flex-wrap gap-2">
            {match.maps.map(m => (
              <span key={m} className="text-xs bg-[#111827] border border-[#1e2d45] px-2 py-1 rounded capitalize">{m}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
