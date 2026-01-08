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
    <div className={`p-6 rounded-2xl border transition-all duration-300 ${highlight ? 'bg-slate-800 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.1)]' : 'bg-slate-800 border-slate-700 shadow-lg'}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-400 text-sm font-medium">{title}</p>
        </div>
        <div className="p-2 bg-slate-700/50 rounded-lg">
          {icon}
        </div>
      </div>
      
      <div className="flex items-end gap-2">
        <h3 className={`text-3xl font-bold ${valueColor ? valueColor : 'text-slate-100'}`}>
          {value}
        </h3>
        {trend && (
          <div className="mb-1">
             {trend === 'up' && <ArrowUpRight className="text-green-400" size={20} />}
             {trend === 'down' && <ArrowDownRight className="text-red-400" size={20} />}
             {trend === 'neutral' && <Minus className="text-slate-500" size={20} />}
          </div>
        )}
      </div>
      
      {subValue && (
        <p className="text-sm text-slate-500 mt-2 font-medium">
          {subValue}
        </p>
      )}
    </div>
  );
};

export default StatsCard;