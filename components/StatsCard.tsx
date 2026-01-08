import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  highlight?: boolean;
  valueColor?: string;
  trend?: 'up' | 'down' | 'neutral';
}

const StatsCard: React.FC<StatsCardProps> = ({ 
  title, 
  value, 
  subValue, 
  icon, 
  highlight = false, 
  valueColor,
  trend 
}) => {
  return (
    <div className={`p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden group ${
      highlight 
        ? 'bg-slate-800/80 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.15)]' 
        : 'bg-slate-800/60 border-slate-700/60 shadow-lg hover:border-slate-600'
    }`}>
      {/* Subtle Gradient Background on Hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <p className="text-slate-400 text-sm font-medium tracking-wide">{title}</p>
        </div>
        <div className={`p-2 rounded-xl backdrop-blur-md ${highlight ? 'bg-yellow-500/10 text-yellow-500' : 'bg-slate-700/50 text-slate-300'}`}>
          {icon}
        </div>
      </div>
      
      <div className="flex items-end gap-2 relative z-10">
        <h3 className={`text-3xl font-bold tracking-tight ${valueColor ? valueColor : 'text-slate-100'}`}>
          {value}
        </h3>
        {trend && (
          <div className="mb-1.5 p-0.5 rounded-full bg-slate-900/50">
             {trend === 'up' && <ArrowUpRight className="text-emerald-400" size={16} />}
             {trend === 'down' && <ArrowDownRight className="text-red-400" size={16} />}
             {trend === 'neutral' && <Minus className="text-slate-500" size={16} />}
          </div>
        )}
      </div>
      
      {subValue && (
        <p className="text-sm text-slate-500 mt-2 font-medium relative z-10">
          {subValue}
        </p>
      )}
    </div>
  );
};

export default StatsCard;