import { useEffect, useState, Component } from 'react';
import Header from './components/Header';
import MatchCard from './components/MatchCard';
import Rankings from './components/Rankings';
import StatsPanel from './components/StatsPanel';
import BankrollDashboard from './components/BankrollDashboard';
import BetHistory from './components/BetHistory';
import { getMatches, getRankings, getStatus, getBankroll, getStats, getHistory, getSettings } from './api';
import { RefreshCw, TrendingUp, Trophy, Info, DollarSign, Clock } from 'lucide-react';

// Captura errores de render y los muestra en pantalla
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e.message }; }
  render() {
    if (this.state.error) return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-8">
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-6 max-w-xl w-full">
          <h2 className="text-red-400 font-bold mb-2">Error de render</h2>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap">{this.state.error}</pre>
        </div>
      </div>
    );
    return this.props.children;
  }
}

const TABS = [
  { id: 'matches',  label: 'Partidos',  icon: TrendingUp },
  { id: 'bankroll', label: 'Bankroll',  icon: DollarSign },
  { id: 'history',  label: 'Historial', icon: Clock },
  { id: 'rankings', label: 'Rankings',  icon: Trophy },
  { id: 'info',     label: 'Info',      icon: Info },
];

function AlgorithmInfo() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-3">Sistema automático</h2>
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex gap-3"><span className="text-green-400 font-mono w-12">5 min</span>Actualiza partidos y cuotas de 1xbet</div>
          <div className="flex gap-3"><span className="text-blue-400 font-mono w-12">1 hora</span>Verifica resultados y actualiza bankroll</div>
          <div className="flex gap-3"><span className="text-purple-400 font-mono w-12">Siempre</span>Guarda predicciones para calcular ROI real</div>
        </div>
      </div>
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-3">Factores del algoritmo</h2>
        {[
          { k: 'Rating HLTV',     p: 25, c: 'bg-blue-500' },
          { k: 'Forma reciente',  p: 20, c: 'bg-purple-500' },
          { k: 'Rating jugadores',p: 20, c: 'bg-orange-500' },
          { k: 'Win Rate',        p: 15, c: 'bg-green-500' },
          { k: 'H2H histórico',   p: 12, c: 'bg-yellow-500' },
          { k: 'Fuerza por mapa', p: 8,  c: 'bg-red-500' },
        ].map(w => (
          <div key={w.k} className="mb-2">
            <div className="flex justify-between text-sm mb-1">
              <span>{w.k}</span><span className="font-mono text-slate-300">{w.p}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${w.c}`} style={{ width: `${w.p * 4}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <h2 className="font-bold mb-2">Kelly Criterion</h2>
        <div className="bg-[#111827] rounded-lg p-3 font-mono text-sm mb-3">
          f* = (p × b - q) / b × fracción
        </div>
        <ul className="text-sm text-slate-400 space-y-1">
          <li><span className="text-white">p</span> = probabilidad predicha de ganar</li>
          <li><span className="text-white">b</span> = cuota neta (cuota - 1)</li>
          <li><span className="text-white">fracción</span> = 0.25 (Quarter Kelly)</li>
          <li className="text-xs text-slate-500 pt-1">Máximo 5% del bankroll por apuesta</li>
        </ul>
      </div>
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
        <h3 className="font-bold text-yellow-400 mb-1">Aviso</h3>
        <p className="text-sm text-slate-400">Herramienta de apoyo estadístico. Apuesta siempre de forma responsable.</p>
      </div>
    </div>
  );
}

function App() {
  const [matches, setMatches]       = useState([]);
  const [rankings, setRankings]     = useState([]);
  const [status, setStatus]         = useState(null);
  const [bankrollData, setBankroll] = useState(null);
  const [stats, setStats]           = useState(null);
  const [history, setHistory]       = useState([]);
  const [settings, setSettings]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('matches');
  const [selected, setSelected]     = useState(null);
  const [filter, setFilter]         = useState('all');

  async function load() {
    setLoading(true);
    try {
      const [m, r, s] = await Promise.all([getMatches(), getRankings(), getStatus()]);
      setMatches(m?.data || []);
      setRankings(r?.data || []);
      setStatus(s);
    } catch (e) { console.error('matches/rankings error:', e); }

    // Cargar datos de bankroll por separado para no bloquear los partidos
    try {
      const [br, st, hist, cfg] = await Promise.all([
        getBankroll(), getStats(), getHistory(), getSettings(),
      ]);
      setBankroll(br || { amount: 100, history: [], stats: {} });
      setStats(st || {});
      setHistory(hist?.data || []);
      setSettings(cfg || {});
    } catch (e) { console.error('bankroll/stats error:', e); }

    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const bets     = matches.filter(m => m.recommendation);
  const filtered = filter === 'bets' ? bets : matches;

  const roi = bankrollData
    ? +((bankrollData.amount - (bankrollData.history?.[0]?.amount || 100)) / (bankrollData.history?.[0]?.amount || 100) * 100).toFixed(2)
    : 0;

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Header status={status} matchCount={matches.length} betCount={bets.length} bankroll={bankrollData?.amount} />
      <main className="max-w-6xl mx-auto px-4 py-6">

        <div className="flex gap-1 mb-6 bg-[#111827] p-1 rounded-xl w-fit overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                ${tab === id ? 'bg-[#1a2235] text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
              <Icon size={13} />{label}
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
                className="ml-auto flex items-center gap-1 text-sm text-slate-400 hover:text-white">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="bg-[#1a2235] border border-[#1e2d45] rounded-xl h-72 animate-pulse" />)}
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

        {tab === 'bankroll' && (
          <BankrollDashboard
            stats={{ ...(stats || {}), roi }}
            bankrollData={bankrollData}
            settings={settings}
            onRefresh={load}
          />
        )}

        {tab === 'history' && <BetHistory history={history} />}

        {tab === 'rankings' && (
          <div className="max-w-2xl">
            {loading
              ? <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl h-96 animate-pulse" />
              : <Rankings rankings={rankings} />}
          </div>
        )}

        {tab === 'info' && <AlgorithmInfo />}
      </main>
    </div>
  );
}

export default function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
