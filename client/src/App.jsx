import { useEffect, useState } from 'react';
import Header from './components/Header';
import MatchCard from './components/MatchCard';
import Rankings from './components/Rankings';
import StatsPanel from './components/StatsPanel';
import { getMatches, getRankings, getStatus } from './api';
import { RefreshCw, TrendingUp, Trophy, Info } from 'lucide-react';

const TABS = [
  { id: 'matches',  label: 'Partidos',  icon: TrendingUp },
  { id: 'rankings', label: 'Rankings',  icon: Trophy },
  { id: 'info',     label: 'Algoritmo', icon: Info },
];

function AlgorithmInfo() {
  const weights = [
    { key: 'Rating HLTV',          pct: 25, color: 'bg-blue-500',   desc: 'Rating global del equipo en HLTV.org' },
    { key: 'Forma reciente',        pct: 20, color: 'bg-purple-500', desc: 'Últimos 5 partidos ponderados por recencia' },
    { key: 'Rating de jugadores',   pct: 20, color: 'bg-orange-500', desc: 'Promedio del rating individual de los 5 jugadores' },
    { key: 'Win Rate',              pct: 15, color: 'bg-green-500',  desc: 'Porcentaje de victorias general' },
    { key: 'H2H histórico',         pct: 12, color: 'bg-yellow-500', desc: 'Historial de enfrentamientos directos' },
    { key: 'Fuerza en mapa',        pct: 8,  color: 'bg-red-500',    desc: 'Win rate en los mapas específicos del partido' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-1">¿Cómo funciona el predictor?</h2>
        <p className="text-sm text-slate-400 mb-4">
          Calcula una puntuación ponderada para cada equipo y la compara con las cuotas del
          bookmaker para encontrar valor (EV positivo).
        </p>
        <div className="space-y-3">
          {weights.map(w => (
            <div key={w.key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{w.key}</span>
                <span className="font-mono text-slate-300">{w.pct}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-1">
                <div className={`h-full rounded-full ${w.color}`} style={{ width: `${w.pct * 4}%` }} />
              </div>
              <p className="text-xs text-slate-500">{w.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-3">Expected Value (EV)</h2>
        <div className="bg-[#111827] rounded-lg p-3 font-mono text-sm mb-3">
          <span className="text-blue-400">EV</span> = (<span className="text-green-400">prob_nuestra</span> × <span className="text-orange-400">cuota</span>) - 1
        </div>
        <ul className="text-sm text-slate-400 space-y-1">
          <li>• <span className="text-green-400 font-bold">EV {'>'} +5%</span> → Valor positivo, considerar apostar</li>
          <li>• <span className="text-yellow-400 font-bold">EV 0–5%</span> → Valor marginal</li>
          <li>• <span className="text-red-400 font-bold">EV {'<'} 0%</span> → Sin valor, no apostar</li>
        </ul>
      </div>

      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-3">Conectar APIs reales</h2>
        <p className="text-sm text-slate-400 mb-3">
          Añade estas variables en <strong>Railway → Variables</strong>:
        </p>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-blue-400 font-bold">PANDASCORE_API_KEY</span>
            <p className="text-xs text-slate-500 mt-0.5">pandascore.co — datos CS2 en vivo. Free: 1000 req/hora.</p>
          </div>
          <div>
            <span className="text-orange-400 font-bold">ODDS_API_KEY</span>
            <p className="text-xs text-slate-500 mt-0.5">the-odds-api.com — cuotas 1xbet en tiempo real. Free: 500 req/mes.</p>
          </div>
        </div>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
        <h3 className="font-bold text-yellow-400 mb-1">⚠️ Aviso</h3>
        <p className="text-sm text-slate-400">
          Herramienta de apoyo estadístico. Apuesta siempre de forma responsable.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [matches, setMatches]   = useState([]);
  const [rankings, setRankings] = useState([]);
  const [status, setStatus]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('matches');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState('all');

  async function load() {
    setLoading(true);
    try {
      const [m, r, s] = await Promise.all([getMatches(), getRankings(), getStatus()]);
      setMatches(m.data || []);
      setRankings(r.data || []);
      setStatus(s);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const bets = matches.filter(m => m.recommendation);
  const filtered = filter === 'bets' ? bets : matches;

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Header status={status} matchCount={matches.length} betCount={bets.length} />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-1 mb-6 bg-[#111827] p-1 rounded-xl w-fit">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${tab === id ? 'bg-[#1a2235] text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'matches' && (
          <>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setFilter('all')}
                className={`text-sm px-3 py-1.5 rounded-lg transition-all
                  ${filter === 'all' ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400' : 'text-slate-400 hover:text-white'}`}>
                Todos ({matches.length})
              </button>
              <button onClick={() => setFilter('bets')}
                className={`text-sm px-3 py-1.5 rounded-lg transition-all
                  ${filter === 'bets' ? 'bg-green-500/20 border border-green-500/40 text-green-400' : 'text-slate-400 hover:text-white'}`}>
                Con valor ({bets.length})
              </button>
              <button onClick={load} disabled={loading}
                className="ml-auto flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Actualizar
              </button>
            </div>
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-[#1a2235] border border-[#1e2d45] rounded-xl h-64 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(pred => (
                  <div key={pred.matchId}
                    onClick={() => setSelected(selected?.matchId === pred.matchId ? null : pred)}
                    className="cursor-pointer">
                    <MatchCard prediction={pred} />
                    {selected?.matchId === pred.matchId && <StatsPanel prediction={pred} />}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'rankings' && (
          <div className="max-w-2xl">
            {loading
              ? <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl h-96 animate-pulse" />
              : <Rankings rankings={rankings} />}
          </div>
        )}

        {tab === 'info' && <div className="max-w-2xl"><AlgorithmInfo /></div>}
      </main>
    </div>
  );
}
