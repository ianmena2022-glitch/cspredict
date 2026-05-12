import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target, BarChart2, Settings } from 'lucide-react';
import { updateBankroll, updateSettings } from '../api';

function StatBox({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-[#111827] rounded-xl p-4 border border-[#1e2d45]">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniChart({ history }) {
  if (!history || history.length < 2) return null;
  const amounts = history.map(h => h.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const range = max - min || 1;
  const w = 300, h = 60;
  const pts = amounts.map((a, i) => {
    const x = (i / (amounts.length - 1)) * w;
    const y = h - ((a - min) / range) * (h - 8) - 4;
    return `${x},${y}`;
  }).join(' ');
  const last = amounts[amounts.length - 1];
  const first = amounts[0];
  const up = last >= first;

  return (
    <div className="bg-[#111827] rounded-xl p-4 border border-[#1e2d45]">
      <div className="text-xs text-slate-400 mb-2 flex items-center gap-1">
        <BarChart2 size={11} /> Evolución del bankroll
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 60 }}>
        <polyline points={pts} fill="none"
          stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="2" />
        <polygon points={`0,${h} ${pts} ${w},${h}`}
          fill={up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'} />
      </svg>
    </div>
  );
}

export default function BankrollDashboard({ stats, bankrollData, settings, onRefresh }) {
  const [editBankroll, setEditBankroll] = useState(false);
  const [newAmount, setNewAmount]       = useState('');
  const [editSettings, setEditSettings] = useState(false);
  const [localSettings, setLocalSettings] = useState(settings || {});

  const { amount = 0, history = [] } = bankrollData || {};
  const s = stats || {};

  const winRate  = s.wins && s.bets_made ? ((s.wins / s.bets_made) * 100).toFixed(1) : '—';
  const roi      = typeof s.roi === 'number' ? s.roi : 0;
  const profit   = typeof s.total_profit === 'number' ? s.total_profit : 0;

  async function saveBankroll() {
    if (!newAmount || isNaN(newAmount)) return;
    await updateBankroll(+newAmount, 'Ajuste manual');
    setEditBankroll(false);
    setNewAmount('');
    onRefresh();
  }

  async function saveSettings() {
    await updateSettings(localSettings);
    setEditSettings(false);
    onRefresh();
  }

  return (
    <div className="space-y-4">
      {/* Bankroll principal */}
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold flex items-center gap-2">
            <DollarSign size={16} className="text-green-400" /> Bankroll
          </h2>
          <div className="flex gap-2">
            <button onClick={() => setEditSettings(!editSettings)}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 bg-[#111827] rounded">
              <Settings size={11} /> Config
            </button>
            <button onClick={() => setEditBankroll(!editBankroll)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-[#111827] rounded">
              Ajustar
            </button>
          </div>
        </div>

        <div className="text-4xl font-bold text-white mb-1">
          ${amount.toFixed(2)}
        </div>
        <div className={`text-sm flex items-center gap-1 ${roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {roi >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          ROI: {roi >= 0 ? '+' : ''}{roi}%
          <span className="text-slate-500 ml-1">
            ({profit >= 0 ? '+' : ''}${profit.toFixed(2)})
          </span>
        </div>

        {editBankroll && (
          <div className="mt-3 flex gap-2">
            <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)}
              placeholder="Nuevo balance"
              className="flex-1 bg-[#111827] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
            <button onClick={saveBankroll}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded">
              Guardar
            </button>
          </div>
        )}

        {editSettings && (
          <div className="mt-3 space-y-2 border-t border-[#1e2d45] pt-3">
            <div className="text-xs text-slate-400 mb-2">Configuración del sistema</div>
            {[
              { key: 'kelly_fraction', label: 'Fracción Kelly (0.25 = quarter Kelly)', type: 'number', step: '0.05' },
              { key: 'min_ev',         label: 'EV mínimo para recomendar (ej: 0.05 = 5%)', type: 'number', step: '0.01' },
              { key: 'min_edge',       label: 'Edge mínimo vs mercado (ej: 0.03 = 3%)', type: 'number', step: '0.01' },
              { key: 'onebet_url',     label: 'URL de 1xbet (tu dominio regional)', type: 'text', step: null,
                placeholder: 'https://1xbet.com/en/line/esports/counter-strike-2' },
            ].map(({ key, label, type, step, placeholder }) => (
              <div key={key}>
                <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                <input type={type} step={step || undefined}
                  value={localSettings[key] || ''}
                  placeholder={placeholder}
                  onChange={e => setLocalSettings(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full bg-[#111827] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500 placeholder:text-slate-600" />
              </div>
            ))}
            <button onClick={saveSettings}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 py-1.5 rounded w-full mt-1">
              Guardar configuración
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Win Rate" value={`${winRate}%`} sub={`${s.wins || 0}W / ${s.losses || 0}L`} color="text-blue-400" />
        <StatBox label="Mis bets" value={s.bets_made || 0} sub={`${s.resolved || 0} resueltas · ${s.pending || 0} pendientes`} />
        <StatBox label="Profit total" value={`${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
          color={profit >= 0 ? 'text-green-400' : 'text-red-400'} />
        <StatBox label="EV promedio" value={s.avg_ev ? `${(s.avg_ev * 100).toFixed(1)}%` : '—'}
          sub="en mis bets" color="text-yellow-400" />
      </div>

      {/* Gráfico */}
      <MiniChart history={history} />
    </div>
  );
}
