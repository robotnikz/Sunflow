
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Label } from 'recharts';

interface EnergyDonutProps {
  percentage: number;
  color: string;
}

const EnergyDonut: React.FC<EnergyDonutProps> = ({ percentage, color }) => {
  // Ensure percentage is 0-100
  const val = Math.min(Math.max(percentage, 0), 100);
  
  const data = [
    { name: 'Value', value: val },
    { name: 'Remaining', value: 100 - val }
  ];

  return (
    <div className="w-full h-full relative flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
            <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="75%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                stroke="none"
                cornerRadius={4}
                paddingAngle={5}
            >
                <Cell key="cell-val" fill={color} />
                <Cell key="cell-rem" fill="#1e293b" /> {/* slate-800 darker */}
                <Label
                    value={`${val.toFixed(0)}%`}
                    position="center"
                    className="font-bold fill-slate-100"
                    style={{ 
                        fontSize: '1.2rem', 
                        filter: 'drop-shadow(0px 2px 2px rgba(0,0,0,0.5))',
                        fontWeight: 700
                    }}
                />
            </Pie>
            </PieChart>
        </ResponsiveContainer>
        
        {/* Subtle glow behind the ring */}
        <div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none opacity-20 blur-md"
            style={{ 
                backgroundColor: color, 
                width: '70%',
                height: '70%'
            }}
        ></div>
    </div>
  );
};

export default EnergyDonut;
