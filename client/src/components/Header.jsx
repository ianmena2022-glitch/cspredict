import { Crosshair, Activity, AlertTriangle } from 'lucide-react';

export default function Header({ status, matchCount, betCount }) {
  const isMock = !status || status.mode === 'mock_data';
  return (
    <header className="border-b border-[#1e2d45] bg-[#111827]/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500/20 border border-orange-500/40 rounded-lg flex items-center justify-center">
            <Crosshair size={16} className="text-orange-400" />
          </div>
          <div>
            <h1 className="font-bold text-white leading-none">CSPredict</h1>
            <p className="text-xs text-slate-500">CS2 Betting Analyzer</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isMock && (
            <div className="flex items-center gap-1 text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-2 py-1 rounded">
              <AlertTriangle size={11} />
              <span className="hidden sm:inline">Modo demo</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Activity size={12} className="text-green-400" />
            <span>{matchCount} partidos</span>
          </div>
          {betCount > 0 && (
            <div className="bg-green-500/20 border border-green-500/40 text-green-400 text-xs px-2 py-1 rounded font-bold">
              {betCount} bets
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
