
import React from 'react';
import { useI18n } from '../services/i18n';

interface StatusTimelineProps {
  history: Array<{
    timestamp: string;
    status?: number; // 0=Offline, 1=Running, 2=Error, 3=Idle
    soc: number;
  }>;
}

const StatusTimeline: React.FC<StatusTimelineProps> = ({ history }) => {
  const { t, locale } = useI18n();
  // Render placeholder if no data, but component must be visible
  if (!history || history.length === 0) {
      return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg">
           <h3 className="text-slate-200 text-lg font-semibold mb-4">{t('Inverter Status')}</h3>
           <div className="h-16 flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-700 rounded-lg">
             {t('Waiting for data logs...')}
           </div>
        </div>
      );
  }

  const totalPoints = history.length;
  
  // Smart Tick Formatting
  const startTime = new Date(history[0].timestamp).getTime();
  const endTime = new Date(history[history.length - 1].timestamp).getTime();
  const durationHours = (endTime - startTime) / (1000 * 60 * 60);
  
  // Title Logic based on duration
  let timeframeLabel = t('Long Term');
  if (durationHours <= 1.2) timeframeLabel = t('1h'); // Tolerance for gaps
  else if (durationHours <= 25) timeframeLabel = t('24h');
  else if (durationHours <= 180) timeframeLabel = t('7 Days');
  else if (durationHours <= 750) timeframeLabel = t('30 Days');

  const showDate = durationHours > 24;

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    if (showDate) {
         return d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  // Helper to compress data into visual segments
  const createSegments = (getValue: (p: any) => any, getLabel: (val: any) => string, getColor: (val: any) => string) => {
    const segments: Array<{ value: any; start: number; count: number; label: string; color: string }> = [];
    
    let current = { 
        value: getValue(history[0]), 
        start: 0, 
        count: 0,
        label: getLabel(getValue(history[0])),
        color: getColor(getValue(history[0]))
    };

    history.forEach((point, index) => {
      const val = getValue(point);
      if (val !== current.value) {
        segments.push({ ...current });
        current = { 
            value: val, 
            start: index, 
            count: 1,
            label: getLabel(val),
            color: getColor(val)
        };
      } else {
        current.count++;
      }
    });
    segments.push(current);

    // Calc widths
    return segments.map(seg => ({
      ...seg,
      width: (seg.count / totalPoints) * 100
    }));
  };

  const errorSegments = createSegments(
    (p) => p.status === 2 ? 'error' : 'ok',
    (val) => val === 'error' ? t('Error') : t('Flawless'),
    (val) => val === 'error' ? 'bg-red-500' : 'bg-emerald-600'
  );

  const statusSegments = createSegments(
    (p) => {
        if (p.status === 0) return 'offline';
        if (p.status === 3) return 'idle';
        if (p.status === 2) return 'error';
        return 'running';
    },
    (val) => {
      if (val === 'offline') return t('Offline');
      if (val === 'idle') return t('Idle');
      if (val === 'error') return t('Error');
      return t('Running');
    },
    (val) => {
      if (val === 'offline') return 'bg-slate-500';
      if (val === 'idle') return 'bg-blue-900/80'; // Dark Blue for Idle/Standby
        if (val === 'error') return 'bg-red-500';
      return 'bg-emerald-600';
    }
  );

  const batterySegments = createSegments(
    (p) => p.soc > 0 ? 'active' : 'idle',
    (val) => val === 'active' ? t('Active') : t('Idle'),
    (val) => val === 'active' ? 'bg-emerald-600' : 'bg-slate-500'
  );

  const ticks = totalPoints > 0 ? [
    history[0].timestamp,
    history[Math.floor(totalPoints / 2)].timestamp,
    history[totalPoints - 1].timestamp
  ].map(t => formatTime(t)) : [];

  const Row = ({ label, segments }: { label: string, segments: typeof errorSegments }) => (
    <div className="contents">
        <div className="text-sm font-medium text-slate-400 py-1">{label}</div>
        <div className="relative h-8 w-full bg-slate-900 rounded flex overflow-hidden">
            {segments.map((seg, i) => (
                <div 
                    key={i} 
                    className={`h-full flex items-center pl-2 overflow-hidden whitespace-nowrap transition-all border-r border-slate-900/10 ${seg.color}`}
                    style={{ width: `${seg.width}%` }}
                    title={`${seg.label} (${Math.round(seg.width)}%)`}
                >
                    {seg.width > 10 && (
                      <span className="text-xs font-bold sf-force-white drop-shadow-md">{seg.label}</span>
                    )}
                </div>
            ))}
        </div>
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg">
      <h3 className="text-slate-200 text-lg font-semibold mb-6">{t('Inverter Status')} ({timeframeLabel})</h3>
      
      <div className="grid grid-cols-[80px_1fr] gap-y-4 gap-x-4 items-center">
        <Row label={t('Errors')} segments={errorSegments} />
        <Row label={t('Status')} segments={statusSegments} />
        <Row label={t('Battery')} segments={batterySegments} />
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-x-4 mt-2">
         <div></div> 
        <div className="flex justify-between text-xs text-slate-400 px-1">
            <span>{ticks[0]}</span>
            <span>{ticks[1]}</span>
            <span>{ticks[2]}</span>
         </div>
      </div>
      
      <div className="flex gap-6 mt-6 justify-center border-t border-slate-700/50 pt-4 flex-wrap">
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-emerald-600 rounded"></div>
            <span className="text-xs text-slate-400">{t('Running / OK')}</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-blue-900/60 rounded"></div>
            <span className="text-xs text-slate-400">{t('Standby / Idle')}</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-red-500 rounded"></div>
            <span className="text-xs text-slate-400">{t('Error')}</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-slate-600 rounded"></div>
            <span className="text-xs text-slate-400">{t('Offline')}</span>
            </div>
        </div>
    </div>
  );
};

export default StatusTimeline;
