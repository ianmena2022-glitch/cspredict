import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function ChangeIcon({ change }) {
  if (change > 0) return <span className="flex items-center text-green-400 text-xs gap-0.5"><TrendingUp size={12} />+{change}</span>;
  if (change < 0) return <span className="flex items-center text-red-400 text-xs gap-0.5"><TrendingDown size={12} />{change}</span>;
  return <span className="text-slate-500 text-xs flex"><Minus size={12} /></span>;
}

export default function Rankings({ rankings }) {
  return (
    <div className="bg-[#1a2235] border border-[#1e2d45] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d45] flex items-center justify-between">
        <h2 className="font-bold text-sm">Rankings HLTV</h2>
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">CS2</span>
      </div>
      <div className="divide-y divide-[#1e2d45]">
        {rankings.map(({ rank, team, points, change, teamData }) => (
          <div key={rank} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111827] transition-colors">
            <span className={`w-6 text-center font-bold text-sm
              ${rank === 1 ? 'text-yellow-400' : rank <= 3 ? 'text-blue-400' : 'text-slate-500'}`}>
              {rank}
            </span>
            <span className="text-xl">{teamData?.logo || '❓'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{teamData?.tag}</span>
                <span className="text-xs text-slate-400 truncate hidden sm:block">{teamData?.name}</span>
              </div>
              <div className="flex gap-0.5 mt-0.5">
                {teamData?.recentForm?.map((r, i) => (
                  <span key={i} className={`w-3 h-3 rounded-sm text-[9px] flex items-center justify-center font-bold
                    ${r === 'W' ? 'bg-green-500/30 text-green-400' : 'bg-red-500/30 text-red-400'}`}>{r}</span>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono text-slate-300">{points}</div>
              <ChangeIcon change={change} />
            </div>
            <div className="hidden md:block text-right">
              <div className="text-xs text-slate-500">Win rate</div>
              <div className="text-sm font-bold text-blue-400">{((teamData?.winRate || 0) * 100).toFixed(0)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
