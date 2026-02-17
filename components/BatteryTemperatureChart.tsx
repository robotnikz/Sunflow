import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useI18n } from '../services/i18n';

interface BatteryTemperatureChartProps {
  history: Array<{
    timestamp: string;
    batteryTemp?: number | null;
  }>;
  timeRange: string;
}

const BatteryTemperatureChart: React.FC<BatteryTemperatureChartProps> = ({ history, timeRange }) => {
  const { t, locale } = useI18n();
  if (history.length === 0) return null;

  const formatTick = (ts: string) => {
    const d = new Date(ts);

    switch (timeRange) {
      case 'hour':
        return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      case 'day':
        return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      case 'week':
        return d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit' });
      case 'month':
        return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
      case 'year':
        return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
      case 'custom':
        return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      default:
        return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const d = new Date(label);
    const dateStr = d.toLocaleString(locale);

    return (
      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-2xl antialiased" style={{ boxShadow: '0 10px 30px -10px rgba(0,0,0,0.8)' }}>
        <p className="text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1 text-xs tracking-wide">
          {dateStr}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-6 text-xs">
              <span className="text-emerald-400 font-bold">{t('Battery Temp:')}</span>
              <span className="text-slate-100 font-mono font-bold tracking-tight">
                {entry.value === null || entry.value === undefined ? t('n/a') : `${Number(entry.value).toFixed(1)}°C`}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTick}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          unit="°C"
          allowDecimals
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="batteryTemp"
          stroke="#34D399"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default BatteryTemperatureChart;
