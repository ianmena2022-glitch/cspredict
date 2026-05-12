import { CheckCircle, XCircle, Clock } from 'lucide-react';

const STATUS_ICON = {
  resolved: null,
  pending:  <Clock size={13} className="text-yellow-400" />,
};

const CONF_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-orange-400' };

export default function BetHistory({ history }) {
  const bets = (history || []).filter(h => h.recommended);

  if (!bets.length) {
    return (
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-8 text-center text-slate-500">
        No hay bets registradas aún. El sistema las guardará automáticamente.
      </div>
    );
  }

  return (
    <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d45] flex items-center justify-between">
        <h2 className="font-bold text-sm">Historial de bets</h2>
        <span className="text-xs text-slate-500">{bets.length} total</span>
      </div>
      <div className="divide-y divide-[#1e2d45] overflow-auto max-h-96">
        {bets.map(b => {
          const won  = b.status === 'resolved' && b.result === b.recommended;
          const lost = b.status === 'resolved' && b.result !== b.recommended;
          return (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111827] transition-colors">
              {/* Icono resultado */}
              <div className="w-5 flex-shrink-0">
                {b.status === 'pending' && <Clock size={14} className="text-yellow-400" />}
                {won  && <CheckCircle size={14} className="text-green-400" />}
                {lost && <XCircle     size={14} className="text-red-400" />}
              </div>

              {/* Partido */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {b.team1} vs {b.team2}
                </div>
                <div className="text-xs text-slate-400 truncate">{b.tournament}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-blue-400 font-medium">→ {b.recommended}</span>
                  {b.confidence && (
                    <span className={`text-xs font-bold ${CONF_COLOR[b.confidence] || 'text-slate-400'}`}>
                      {b.confidence.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>

              {/* Kelly & odds */}
              <div className="text-right text-xs hidden md:block">
                <div className="text-slate-300">${b.kelly_amount?.toFixed(2) || '—'}</div>
                <div className="text-slate-500">Kelly {b.kelly_fraction?.toFixed(1)}%</div>
              </div>

              {/* EV */}
              <div className="text-right text-xs w-14">
                <div className={b.ev > 0 ? 'text-green-400' : 'text-red-400'}>
                  EV {b.ev ? `${(b.ev * 100).toFixed(1)}%` : '—'}
                </div>
                {b.status === 'resolved' && (
                  <div className={b.profit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                    {b.profit >= 0 ? '+' : ''}${b.profit?.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
