
import React from 'react';
import { RoiData } from '../types';
import { TrendingUp, CalendarCheck, AlertCircle } from 'lucide-react';

interface AmortizationWidgetProps {
  roiData: RoiData | null;
  currency: string;
}

const AmortizationWidget: React.FC<AmortizationWidgetProps> = ({ roiData, currency }) => {
  if (!roiData || roiData.totalInvested === 0) {
    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg flex flex-col items-center justify-center min-h-[220px] text-center">
            <div className="p-3 bg-slate-700/50 rounded-full mb-3 text-slate-400">
                <TrendingUp size={24} />
            </div>
            <h3 className="text-slate-200 font-semibold">Amortization Tracker</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-xs">
                Configure your system costs (Expenses) in settings to track your Return on Investment.
            </p>
        </div>
    );
  }

  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const percent = Math.min(100, Math.max(0, roiData.roiPercent));
  
  // Format large numbers
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const breakEvenDate = roiData.breakEvenDate ? new Date(roiData.breakEvenDate) : null;
  const isPaidOff = roiData.netValue >= 0;

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg relative overflow-hidden flex flex-col justify-between w-full">
        {/* Background Gradient for success */}
        {isPaidOff && (
            <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 blur-[60px] rounded-full pointer-events-none"></div>
        )}

        <div className="flex justify-between items-start mb-4">
            <h3 className="text-slate-400 text-sm font-medium flex items-center gap-2">
                <TrendingUp size={16} className={isPaidOff ? 'text-emerald-400' : 'text-blue-400'}/>
                Return on Investment
            </h3>
            {isPaidOff && (
                <span className="px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-700/50 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                    Paid Off
                </span>
            )}
        </div>

        {/* Main Stat: Percent */}
        <div className="mb-6">
            <div className="flex items-baseline gap-2">
                <span className={`text-4xl font-bold tracking-tight ${isPaidOff ? 'text-emerald-400' : 'text-slate-100'}`}>
                    {roiData.roiPercent.toFixed(1)}%
                </span>
                <span className="text-sm text-slate-500">recovered</span>
            </div>
            
            {/* Progress Bar */}
            <div className="w-full h-3 bg-slate-900 rounded-full mt-3 overflow-hidden border border-slate-700/50 relative">
                <div 
                    className={`h-full rounded-full transition-all duration-1000 ${isPaidOff ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-gradient-to-r from-red-500 via-orange-400 to-yellow-400'}`}
                    style={{ width: `${percent}%` }}
                ></div>
                {/* Marker for 100% */}
                <div className="absolute top-0 bottom-0 left-[100%] w-0.5 bg-white/20"></div>
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
                <span>{symbol}{fmt(roiData.totalReturned)} returned</span>
                <span>Invested to date: {symbol}{fmt(roiData.totalInvested)}</span>
            </div>
        </div>

        {/* Forecast Section */}
        <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/50">
            {isPaidOff ? (
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                        <CalendarCheck size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase font-bold">Net Profit</div>
                        <div className="text-emerald-400 font-bold text-lg">
                            +{symbol}{fmt(roiData.netValue)}
                        </div>
                    </div>
                </div>
            ) : breakEvenDate ? (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg self-start">
                            <CalendarCheck size={20} />
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 uppercase font-bold">Estimated Break-even</div>
                            <div className="text-slate-200 font-bold">
                                {breakEvenDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                            </div>
                            {roiData.projectedBreakEvenCost && (
                                <div className="text-[10px] text-slate-400 mt-1">
                                    Total Cost at Break-even: <span className="font-mono text-slate-300 font-bold">{symbol}{fmt(roiData.projectedBreakEvenCost)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-3 opacity-60">
                    <AlertCircle size={20} className="text-slate-500" />
                    <span className="text-xs text-slate-500">Need more data for forecast...</span>
                </div>
            )}
        </div>
    </div>
  );
};

export default AmortizationWidget;
