import { useState, useEffect, useRef } from 'react';
import { Clock, Tv, TrendingUp, AlertCircle, CheckCircle, DollarSign, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { addBet, getMatchOdds } from '../api';

const TIER_COLOR = {
  S: 'text-yellow-400 bg-yellow-400/10',
  A: 'text-blue-400 bg-blue-400/10',
  B: 'text-gray-400 bg-gray-400/10',
};
const CONF_COLOR = { high: 'text-green-400', medium: 'text-yellow-400', low: 'text-orange-400', neutral: 'text-slate-400' };
const CONF_LABEL = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA', neutral: 'SIN BET' };

const DEFAULT_ONEBET_URL = 'https://1xbet.com/en/line/esports/counter-strike-2';

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

export default function MatchCard({ prediction, settings }) {
  const { match, team1, team2, recommendation, confidence, kellyAmount, kellyPct, pinnacleUsed, insufficientData, usingDynamic, isLan, noOdds } = prediction;
  const oddsSource = match?.oddsSource;
  const [accepted, setAccepted]       = useState(false);
  const [oddsVisible, setOddsVisible] = useState(false);
  const [liveOdds, setLiveOdds]       = useState(null);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsUpdatedAt, setOddsUpdatedAt] = useState(null);
  const intervalRef = useRef(null);

  async function fetchOdds() {
    setOddsLoading(true);
    try {
      const data = await getMatchOdds(match.id);
      if (data?.odds) {
        setLiveOdds(data);
        setOddsUpdatedAt(data.updatedAt ? new Date(data.updatedAt) : new Date());
      }
    } catch (e) { /* silencioso */ }
    finally { setOddsLoading(false); }
  }

  function revealOdds(e) {
    e.stopPropagation();
    setOddsVisible(true);
    fetchOdds();
    intervalRef.current = setInterval(fetchOdds, 15 * 60 * 1000);
  }

  function hideOdds(e) {
    e.stopPropagation();
    setOddsVisible(false);
    setLiveOdds(null);
    clearInterval(intervalRef.current);
  }

  // Limpiar interval si se desmonta el componente
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const onebetUrl = settings?.onebet_url || DEFAULT_ONEBET_URL;

  function openOneBet(e) {
    e.stopPropagation();
    window.open(onebetUrl, '_blank');
  }

  if (!team1 || !team2 || !match) return null;
  const isRec1 = recommendation === match.team1;
  const isRec2 = recommendation === match.team2;
  const recTeam = isRec1 ? team1 : isRec2 ? team2 : null;
  const recOdds = isRec1 ? match.odds.team1 : match.odds.team2;

  const oddsMovement = match?.oddsMovement || prediction?.oddsMovement || null;

  async function acceptBet(e) {
    e.stopPropagation();
    if (!recTeam || accepted) return;
    try {
      await addBet({
        match_id:    match.id,
        tournament:  match.tournament,
        team1:       team1.name || team1.tag,
        team2:       team2.name || team2.tag,
        bet_on:      recTeam.name || recTeam.tag,
        odds:        recOdds,
        amount:      kellyAmount,
        ev:          recTeam.ev,
        kelly_pct:   kellyPct,
        match_date:  match.date,
        format:      match.format,
      });
      setAccepted(true);
      setTimeout(() => setAccepted(false), 3000);
    } catch (err) {
      console.error('addBet error:', err);
    }
  }

  return (
    <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 hover:border-blue-500/40 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${TIER_COLOR[match.tournamentTier] || TIER_COLOR.B}`}>
            TIER {match.tournamentTier}
          </span>
          <span className="text-xs text-slate-400 truncate max-w-[140px]">{match.tournament}</span>
          {insufficientData && (
            <span className="text-xs px-2 py-0.5 rounded font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
              SIN DATOS
            </span>
          )}
          {isLan && !insufficientData && (
            <span className="text-xs px-2 py-0.5 rounded font-bold bg-purple-500/10 text-purple-400 border border-purple-500/30">
              LAN
            </span>
          )}
          {usingDynamic && !insufficientData && (
            <span className="text-xs px-2 py-0.5 rounded font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              📡 Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
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
          {!noOdds && <div className="text-lg font-bold text-white mt-1">{match.odds.team1}x</div>}
          {!noOdds && <EVBadge ev={team1.ev} />}
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
          {!noOdds && <div className="text-lg font-bold text-white mt-1">{match.odds.team2}x</div>}
          {!noOdds && <EVBadge ev={team2.ev} />}
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

      {/* Cuotas bajo demanda */}
      {noOdds ? (
        <div className="w-full mb-3 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs
          text-slate-600 border border-dashed border-slate-800 cursor-default">
          Sin cuotas disponibles (OddsPapi)
        </div>
      ) : !oddsVisible ? (
        <button
          onClick={revealOdds}
          className="w-full mb-3 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs
            text-slate-500 hover:text-slate-300 border border-dashed border-slate-700 hover:border-slate-500 transition-all">
          <Eye size={11} /> Ver cuotas
        </button>
      ) : (
        <div className="bg-[#111827] rounded-lg px-3 py-2 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-500 font-medium">
              Cuotas {oddsSource ? <span className="text-slate-400 uppercase">{oddsSource}</span> : '— verificar en 1xbet'}
            </span>
            <div className="flex items-center gap-2">
              {oddsUpdatedAt && (
                <span className="text-xs text-slate-600">
                  {oddsUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button onClick={hideOdds} className="text-slate-600 hover:text-slate-400 transition-colors">
                <EyeOff size={11} />
              </button>
            </div>
          </div>

          {oddsLoading && !liveOdds ? (
            <div className="text-xs text-slate-600 text-center py-1">Cargando...</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xs text-slate-400">{team1.tag}</span>
                  <span className="text-base font-bold text-white font-mono">
                    {liveOdds?.odds?.team1 ?? match.odds.team1}x
                  </span>
                  {(liveOdds?.pinnacleOdds ?? match.pinnacleOdds)?.team1 && (
                    <span className="text-xs text-blue-400 font-mono">
                      P: {(liveOdds?.pinnacleOdds ?? match.pinnacleOdds).team1}x
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-600 font-mono">{match.format?.toUpperCase()}</span>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xs text-slate-400">{team2.tag}</span>
                  <span className="text-base font-bold text-white font-mono">
                    {liveOdds?.odds?.team2 ?? match.odds.team2}x
                  </span>
                  {(liveOdds?.pinnacleOdds ?? match.pinnacleOdds)?.team2 && (
                    <span className="text-xs text-blue-400 font-mono">
                      P: {(liveOdds?.pinnacleOdds ?? match.pinnacleOdds).team2}x
                    </span>
                  )}
                </div>
              </div>
              {(liveOdds?.pinnacleOdds ?? match.pinnacleOdds) && (
                <div className="text-xs text-blue-400/50 text-center mt-1">P = Pinnacle (referencia)</div>
              )}
            </>
          )}
        </div>
      )}

      {(team1.streakNote || team2.streakNote || team1.restNote || team2.restNote) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {team1.streakNote && <span className="text-xs bg-[#111827] px-2 py-1 rounded">{team1.streakNote} {team1.tag}</span>}
          {team2.streakNote && <span className="text-xs bg-[#111827] px-2 py-1 rounded">{team2.streakNote} {team2.tag}</span>}
          {team1.restNote && <span className="text-xs bg-orange-500/10 text-orange-300 px-2 py-1 rounded">{team1.restNote} {team1.tag}</span>}
          {team2.restNote && <span className="text-xs bg-orange-500/10 text-orange-300 px-2 py-1 rounded">{team2.restNote} {team2.tag}</span>}
        </div>
      )}

      {oddsMovement && (
        <div className="mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <TrendingUp size={12} className="text-blue-400 shrink-0" />
          <span className="text-xs text-blue-300">
            {oddsMovement.startsWith('t1_drop')
              ? `Cuota de ${team1.tag} cayó ${oddsMovement.split('_')[2]} — dinero entrando`
              : `Cuota de ${team2.tag} cayó ${oddsMovement.split('_')[2]} — dinero entrando`}
          </span>
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

      {insufficientData && (
        <div className="mb-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} className="text-yellow-400 shrink-0" />
          <span className="text-xs text-yellow-300">Equipo desconocido — probabilidades basadas solo en cuotas de mercado. No apostar.</span>
        </div>
      )}

      {/* Action buttons */}
      {recommendation && kellyAmount > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={acceptBet}
            disabled={accepted}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all
              ${accepted
                ? 'bg-green-500/30 text-green-300 border border-green-500/50 cursor-default'
                : 'bg-green-500/15 hover:bg-green-500/25 text-green-400 hover:text-green-300 border border-green-500/30'}`}>
            <CheckCircle size={12} />
            {accepted ? '¡Bet registrada!' : 'Aceptar apuesta'}
          </button>
          <button
            onClick={openOneBet}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium
              bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 border border-blue-500/30 transition-all">
            <ExternalLink size={12} />
            Ir a 1xbet
          </button>
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
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
          <Tv size={12} /> Stream
        </a>
      </div>
    </div>
  );
}
