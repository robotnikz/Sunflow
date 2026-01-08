import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Label } from 'recharts';

interface EnergyDonutProps {
  percentage: number;
  label: string;
  subLabel?: string;
  color: string;
}

const EnergyDonut: React.FC<EnergyDonutProps> = ({ percentage, label, subLabel, color }) => {
  // Ensure percentage is 0-100
  const val = Math.min(Math.max(percentage, 0), 100);
  
  const data = [
    { name: 'Value', value: val },
    { name: 'Remaining', value: 100 - val }
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="h-[200px] w-full relative">
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
            <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                stroke="none"
            >
                <Cell key="cell-val" fill={color} />
                <Cell key="cell-rem" fill="#1e293b" />
                <Label
                    value={`${val.toFixed(0)}%`}
                    position="center"
                    className="fill-slate-100 text-3xl font-bold"
                />
            </Pie>
            </PieChart>
        </ResponsiveContainer>
        {/* Decorative inner glow */}
        <div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110px] h-[110px] rounded-full pointer-events-none opacity-20"
            style={{ backgroundColor: color, filter: 'blur(20px)' }}
        ></div>
      </div>
      <div className="text-center mt-[-10px]">
        <h3 className="text-slate-200 font-medium text-lg">{label}</h3>
        {subLabel && <p className="text-slate-500 text-sm">{subLabel}</p>}
      </div>
    </div>
  );
};

export default EnergyDonut;