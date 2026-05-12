import { Clock, Tv, TrendingUp, AlertCircle, CheckCircle, DollarSign } from 'lucide-react';

const TIER_COLOR = {
  S: 'text-yellow-400 bg-yellow-400/10',
  A: 'text-blue-400 bg-blue-400/10',
  B: 'text-gray-400 bg-gray-400/10',
};
const CONF_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-orange-400', neutral: 'text-slate-400' };
const CONF_LABEL = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA', neutral: 'SIN BET' };

function timeUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  if (diff < 0) return 'En curso';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function EVBadge({ ev }) {
  const pos = ev > 0;
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold
      ${pos ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
      EV {pos ? '+' : ''}{(ev * 100).toFixed(1)}%
    </span>
  );
}

function ProbBar({ p1, p2 }) {
  return (
    <div className="w-full flex rounded-full overflow-hidden h-2 my-1">
      <div className="bg-blue-500 transition-all" style={{ width: `${p1}%` }} />
      <div className="bg-orange-500 transition-all" style={{ width: `${p2}%` }} />
    </div>
  );
}

export default function MatchCard({ prediction }) {
  const { match, team1, team2, recommendation, confidence, kellyAmount, kellyPct, pinnacleUsed } = prediction;
  const isRec1 = recommendation === match.team1;
  const isRec2 = recommendation === match.team2;

  return (
    <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 hover:border-blue-500/40 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${TIER_COLOR[match.tournamentTier] || TIER_COLOR.B}`}>
            TIER {match.tournamentTier}
          </span>
          <span className="text-xs text-slate-400 truncate max-w-[180px]">{match.tournament}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <Clock size={12} />
          <span>{timeUntil(match.date)}</span>
        </div>
      </div>

      {/* Teams */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex-1 flex flex-col items-center p-3 rounded-lg transition-all
          ${isRec1 ? 'bg-green-500/10 border border-green-500/30' : 'bg-[#111827]'}`}>
          <span className="text-2xl mb-1">{team1.logo}</span>
          <span className="font-bold text-sm">{team1.tag}</span>
          <span className="text-xs text-slate-400 mb-2 text-center">{team1.name}</span>
          <div className="text-xl font-bold text-blue-400">{team1.probability}%</div>
          <div className="text-lg font-bold text-white mt-1">{match.odds.team1}x</div>
          <EVBadge ev={team1.ev} />
          {isRec1 && (
            <div className="mt-2 flex items-center gap-1 text-green-400 text-xs font-bold">
              <CheckCircle size={12} /> APOSTAR
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-slate-500 font-bold text-sm">VS</span>
          <span className="text-xs text-slate-500 uppercase font-mono">{match.format}</span>
        </div>

        <div className={`flex-1 flex flex-col items-center p-3 rounded-lg transition-all
          ${isRec2 ? 'bg-green-500/10 border border-green-500/30' : 'bg-[#111827]'}`}>
          <span className="text-2xl mb-1">{team2.logo}</span>
          <span className="font-bold text-sm">{team2.tag}</span>
          <span className="text-xs text-slate-400 mb-2 text-center">{team2.name}</span>
          <div className="text-xl font-bold text-orange-400">{team2.probability}%</div>
          <div className="text-lg font-bold text-white mt-1">{match.odds.team2}x</div>
          <EVBadge ev={team2.ev} />
          {isRec2 && (
            <div className="mt-2 flex items-center gap-1 text-green-400 text-xs font-bold">
              <CheckCircle size={12} /> APOSTAR
            </div>
          )}
        </div>
      </div>

      <ProbBar p1={team1.probability} p2={team2.probability} />
      <div className="flex justify-between text-xs text-slate-500 mb-3">
        <span>{team1.tag}</span>
        <span>{team2.tag}</span>
      </div>

      {(team1.streakNote || team2.streakNote) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {team1.streakNote && <span className="text-xs bg-[#111827] px-2 py-1 rounded">{team1.streakNote} {team1.tag}</span>}
          {team2.streakNote && <span className="text-xs bg-[#111827] px-2 py-1 rounded">{team2.streakNote} {team2.tag}</span>}
        </div>
      )}

      {/* Kelly bet amount */}
      {recommendation && kellyAmount > 0 && (
        <div className="mb-3 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1 text-green-400 text-xs font-bold">
            <DollarSign size={13} />
            Apostar: ${kellyAmount.toFixed(2)}
          </div>
          <div className="text-xs text-slate-400">
            Kelly {kellyPct?.toFixed(1)}%
            {pinnacleUsed && <span className="ml-1 text-blue-400">· vs Pinnacle</span>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[#1e2d45]">
        <div className="flex items-center gap-2">
          {recommendation ? (
            <div className="flex items-center gap-1">
              <TrendingUp size={13} className="text-green-400" />
              <span className="text-xs text-slate-400">Confianza:</span>
              <span className={`text-xs font-bold ${CONF_COLOR[confidence]}`}>{CONF_LABEL[confidence]}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-slate-500">
              <AlertCircle size={13} />
              <span className="text-xs">Sin valor claro</span>
            </div>
          )}
        </div>
        <a href={match.stream} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
          <Tv size={12} /> Stream
        </a>
      </div>
    </div>
  );
}
