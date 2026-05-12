import { useState } from 'react';
import { CheckCircle, XCircle, Clock, Trash2, Edit2, Trophy } from 'lucide-react';
import { deleteBet, resolveBet, updateBetAmount } from '../api';

function StatusBadge({ status, won }) {
  if (status === 'pending') return (
    <div className="flex items-center gap-1 text-yellow-400">
      <Clock size={13} /> <span className="text-xs">Pendiente</span>
    </div>
  );
  if (won) return (
    <div className="flex items-center gap-1 text-green-400">
      <CheckCircle size={13} /> <span className="text-xs font-bold">WIN</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1 text-red-400">
      <XCircle size={13} /> <span className="text-xs font-bold">LOSS</span>
    </div>
  );
}

function BetRow({ bet, onRefresh }) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [newAmount, setNewAmount]         = useState(bet.amount?.toFixed(2) || '');
  const [resolving, setResolving]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const won = bet.status === 'resolved' && bet.profit >= 0;

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return; }
    await deleteBet(bet.id);
    onRefresh();
  }

  async function handleResolve(result) {
    await resolveBet(bet.id, result);
    setResolving(false);
    onRefresh();
  }

  async function handleAmountSave() {
    if (!newAmount || isNaN(+newAmount)) return;
    await updateBetAmount(bet.id, +newAmount);
    setEditingAmount(false);
    onRefresh();
  }

  return (
    <div className="px-4 py-3 hover:bg-[#111827] transition-colors border-b border-[#1e2d45] last:border-0">
      <div className="flex items-start gap-3">
        {/* Status */}
        <div className="mt-0.5 w-20 shrink-0">
          <StatusBadge status={bet.status} won={won} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{bet.team1} vs {bet.team2}</div>
          <div className="text-xs text-slate-400 truncate">{bet.tournament}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs font-bold text-green-400">→ {bet.bet_on}</span>
            <span className="text-xs text-slate-400">@ {bet.odds}x</span>
            {bet.ev != null && (
              <span className="text-xs text-blue-400">EV +{(bet.ev * 100).toFixed(1)}%</span>
            )}
          </div>

          {/* Monto editable */}
          <div className="flex items-center gap-2 mt-1">
            {editingAmount ? (
              <>
                <input
                  type="number" step="0.01" value={newAmount}
                  onChange={e => setNewAmount(e.target.value)}
                  className="w-24 bg-[#0a0e1a] border border-blue-500 rounded px-2 py-0.5 text-xs text-white outline-none"
                  autoFocus
                />
                <button onClick={handleAmountSave} className="text-xs text-green-400 hover:text-green-300">OK</button>
                <button onClick={() => setEditingAmount(false)} className="text-xs text-slate-500 hover:text-slate-400">×</button>
              </>
            ) : (
              <button
                onClick={() => bet.status === 'pending' && setEditingAmount(true)}
                className={`flex items-center gap-1 text-xs ${bet.status === 'pending' ? 'text-slate-300 hover:text-white cursor-pointer' : 'text-slate-400 cursor-default'}`}>
                <span className="font-mono">${bet.amount?.toFixed(2)}</span>
                {bet.status === 'pending' && <Edit2 size={10} className="text-slate-500" />}
              </button>
            )}
            {bet.status === 'resolved' && (
              <span className={`text-xs font-bold ${bet.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {bet.profit >= 0 ? '+' : ''}${bet.profit?.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {bet.status === 'pending' && !resolving && (
            <button
              onClick={() => setResolving(true)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600/50 transition-all">
              <Trophy size={11} /> Resultado
            </button>
          )}

          {resolving && (
            <div className="flex gap-1">
              <button onClick={() => handleResolve(bet.bet_on)}
                className="text-xs px-2 py-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30">
                WIN
              </button>
              <button
                onClick={() => {
                  const loser = bet.bet_on === bet.team1 ? bet.team2 : bet.team1;
                  handleResolve(loser || '__loss__');
                }}
                className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30">
                LOSS
              </button>
              <button onClick={() => setResolving(false)} className="text-xs text-slate-500 px-1">×</button>
            </div>
          )}

          <button
            onClick={handleDelete}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-all
              ${confirmDelete
                ? 'bg-red-500/30 text-red-300 border border-red-500/50'
                : 'bg-transparent hover:bg-red-500/10 text-slate-500 hover:text-red-400 border border-transparent'}`}>
            <Trash2 size={11} />
            {confirmDelete ? '¿Seguro?' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManualBets({ bets, onRefresh }) {
  const list = bets || [];
  const pending  = list.filter(b => b.status === 'pending');
  const resolved = list.filter(b => b.status === 'resolved');
  const totalProfit = resolved.reduce((s, b) => s + (b.profit || 0), 0);
  const wins  = resolved.filter(b => b.profit >= 0).length;

  if (!list.length) {
    return (
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-10 text-center">
        <div className="text-4xl mb-3">🎯</div>
        <div className="text-slate-300 font-medium mb-1">No hay bets registradas</div>
        <div className="text-sm text-slate-500">
          Cuando encuentres una apuesta con valor, tocá <span className="text-green-400 font-medium">Aceptar apuesta</span> en la card del partido.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{pending.length}</div>
          <div className="text-xs text-slate-400 mt-0.5">Pendientes</div>
        </div>
        <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">
            {resolved.length ? `${((wins / resolved.length) * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Win Rate ({wins}/{resolved.length})</div>
        </div>
        <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl p-4 text-center">
          <div className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Profit total</div>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e2d45] flex items-center justify-between">
          <h2 className="font-bold text-sm">Mis bets</h2>
          <span className="text-xs text-slate-500">{list.length} total</span>
        </div>
        <div className="divide-y divide-[#1e2d45] max-h-[600px] overflow-y-auto">
          {list.map(bet => (
            <BetRow key={bet.id} bet={bet} onRefresh={onRefresh} />
          ))}
        </div>
      </div>
    </div>
  );
}
