import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Line, ComposedChart } from 'recharts';
import { CalendarDays, MapPin, Sliders, TrendingDown, TrendingUp, Info, RefreshCw, ArrowRight } from 'lucide-react';
import type { AwattarComparisonResponse, SystemConfig, AwattarComparePeriod } from '../types';
import { getAwattarComparison } from '../services/api';

type UiPeriod = AwattarComparePeriod | 'custom';

const PERIOD_LABEL: Record<UiPeriod, string> = {
  week: '7 days',
  month: '30 days',
  halfyear: '6 months',
  year: '12 months',
  custom: 'Custom'
};

const currencySymbolFor = (currency: string | undefined) => {
  if (currency === 'EUR') return '€';
  if (currency === 'GBP') return '£';
  return '$';
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const formatTickDate = (ymd: string) => {
  // ymd = YYYY-MM-DD
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString([], { month: 'short', day: '2-digit' });
};

const DynamicTariffComparison: React.FC<{ config: SystemConfig }> = ({ config }) => {
  const currencySymbol = currencySymbolFor(config.currency);

  const STORAGE_KEY = 'sunflow.awattar.compare';
  const RESULT_KEY = 'sunflow.awattar.compare.result';
  const COMPAT_STORAGE_KEY = 'sunflow.dynamicTariff.compare';
  const COMPAT_RESULT_KEY = 'sunflow.dynamicTariff.compare.result.awattar';

  const stored = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);

      // Best-effort compatibility with prior multi-provider key.
      const compatRaw = localStorage.getItem(COMPAT_STORAGE_KEY);
      return compatRaw ? JSON.parse(compatRaw) : null;
    } catch {
      return null;
    }
  }, []);

  const storedResult = useMemo<AwattarComparisonResponse | null>(() => {
    try {
      const raw = localStorage.getItem(RESULT_KEY);
      if (raw) return JSON.parse(raw) as AwattarComparisonResponse;

      const compatRaw = localStorage.getItem(COMPAT_RESULT_KEY);
      return compatRaw ? (JSON.parse(compatRaw) as AwattarComparisonResponse) : null;
    } catch {
      return null;
    }
  }, []);

  const defaultsFromConfig = (config as any)?.dynamicTariff?.awattar;

  const [isOpen, setIsOpen] = useState<boolean>(stored?.isOpen ?? false);
  const [period, setPeriod] = useState<UiPeriod>(stored?.period || 'month');
  const [from, setFrom] = useState<string>(stored?.from || '');
  const [to, setTo] = useState<string>(stored?.to || '');
  const [country, setCountry] = useState<'DE' | 'AT'>(stored?.country || defaultsFromConfig?.country || 'DE');
  const [surchargeCt, setSurchargeCt] = useState<number>(
    stored?.surchargeCt ?? defaultsFromConfig?.surchargeCt ?? 0
  );
  const [vatPercent, setVatPercent] = useState<number>(
    stored?.vatPercent ?? defaultsFromConfig?.vatPercent ?? 0
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<AwattarComparisonResponse | null>(storedResult);

  const canApply = useMemo(() => {
    if (period !== 'custom') return true;
    return !!from && !!to;
  }, [period, from, to]);

  const saveLocal = (next: any) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const saveResultLocal = (next: AwattarComparisonResponse | null) => {
    try {
      if (!next) {
        localStorage.removeItem(RESULT_KEY);
      } else {
        localStorage.setItem(RESULT_KEY, JSON.stringify(next));
      }
    } catch {
      // ignore
    }
  };

  // Keep UI state stable across dashboard refreshes/re-renders
  useEffect(() => {
    saveLocal({ isOpen, period, from, to, country, surchargeCt, vatPercent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, period, from, to, country, surchargeCt, vatPercent]);

  const apply = async () => {
    if (!canApply) return;

    setLoading(true);
    setError('');
    try {
      const params: any = {};

      params.country = country;
      params.surchargeCt = clamp(Number(surchargeCt || 0), -1000, 5000);
      params.vatPercent = clamp(Number(vatPercent || 0), 0, 50);

      if (period === 'custom') {
        // Backend treats to as exclusive start-of-day. For usability, we send (end + 1 day) so user-selected day is included.
        const end = new Date(`${to}T00:00:00`);
        if (!Number.isNaN(end.getTime())) {
          end.setDate(end.getDate() + 1);
          const y = end.getFullYear();
          const m = String(end.getMonth() + 1).padStart(2, '0');
          const d = String(end.getDate()).padStart(2, '0');
          params.from = from;
          params.to = `${y}-${m}-${d}`;
        } else {
          params.from = from;
          params.to = to;
        }
      } else {
        params.period = period;
      }

      const data = await getAwattarComparison(params);
      setResult(data);

      saveResultLocal(data as any);
      saveLocal({ isOpen, period, from, to, country, surchargeCt: params.surchargeCt ?? surchargeCt, vatPercent: params.vatPercent ?? vatPercent });
    } catch (e: any) {
      setResult(null);
      saveResultLocal(null);
      setError(e?.message || 'Failed to load comparison');
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return [];
    let cum = 0;
    return result.seriesDaily.map(d => {
      const delta = (d.dynamicNet ?? 0) - (d.fixedNet ?? 0);
      cum += delta;
      return {
        date: d.date,
        fixedNet: d.fixedNet,
        dynamicNet: d.dynamicNet,
        delta,
        cumDelta: Math.round(cum * 100) / 100,
        importKwh: d.importKwh,
        exportKwh: d.exportKwh
      };
    });
  }, [result]);

  const summary = useMemo(() => {
    if (!result) return null;
    const delta = result.totals?.delta?.net ?? 0;
    const savings = delta < 0 ? Math.abs(delta) : 0;
    const extra = delta > 0 ? delta : 0;
    const coverage = result.coverage?.hoursWithEnergy
      ? Math.round((result.coverage.hoursUsed / result.coverage.hoursWithEnergy) * 100)
      : 0;
    return { delta, savings, extra, coverage };
  }, [result]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const getVal = (key: string) => {
      const p = payload.find((x: any) => x.dataKey === key);
      return p?.value;
    };

    const fixed = getVal('fixedNet');
    const dyn = getVal('dynamicNet');
    const delta = getVal('delta');
    const cum = getVal('cumDelta');

    return (
      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-2xl">
        <div className="text-xs text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1">{label}</div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-6"><span className="text-slate-400">Fixed net</span><span className="text-slate-100 font-mono">{currencySymbol} {Number(fixed || 0).toFixed(2)}</span></div>
          <div className="flex justify-between gap-6"><span className="text-slate-400">Dynamic net</span><span className="text-slate-100 font-mono">{currencySymbol} {Number(dyn || 0).toFixed(2)}</span></div>
          <div className="flex justify-between gap-6"><span className="text-slate-400">Delta (dyn-fixed)</span><span className={`font-mono ${Number(delta || 0) <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{currencySymbol} {Number(delta || 0).toFixed(2)}</span></div>
          <div className="flex justify-between gap-6"><span className="text-slate-400">Cum. delta</span><span className={`font-mono ${Number(cum || 0) <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{currencySymbol} {Number(cum || 0).toFixed(2)}</span></div>
        </div>
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full bg-gradient-to-r from-indigo-700/60 to-purple-700/60 hover:from-indigo-600/60 hover:to-purple-600/60 p-4 rounded-xl shadow-lg border border-white/10 flex items-center justify-between group transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <TrendingUp className="text-white" size={24} />
          </div>
          <div className="text-left">
            <div className="text-white font-bold text-lg">Dynamic Tariff Comparison (aWATTar)</div>
            <div className="text-indigo-200 text-sm">See if a dynamic tariff would have been cheaper</div>
          </div>
        </div>
        <ArrowRight className="text-white opacity-50 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 blur-[60px] rounded-full pointer-events-none" />

      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className="absolute top-6 right-6 px-3 py-2 rounded-lg border bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-900/60 transition-colors text-sm font-medium"
      >
        Close
      </button>

      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pr-24">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="text-purple-400" />
            Dynamic Tariff Comparison
          </h2>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
            <Info size={14} className="text-slate-500" />
            {'aWATTar provides market (exchange) prices. Add “Surcharge” + VAT to approximate your all-in retail tariff.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={loading || !canApply}
            className={`px-4 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 transition-colors ${
              loading || !canApply
                ? 'bg-slate-900/40 border-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400/30 text-white'
            }`}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Calculating…' : 'Run comparison'}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
          <div className="text-xs text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <CalendarDays size={14} className="text-slate-400" />
            Time window
          </div>

          <div className="flex flex-wrap bg-slate-900 rounded-lg p-1 border border-slate-700">
            {(Object.keys(PERIOD_LABEL) as UiPeriod[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  period === p
                    ? 'bg-slate-700 text-white shadow ring-1 ring-slate-600'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  className="mt-1 w-full bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="mt-1 w-full bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              {!canApply && (
                <div className="col-span-2 text-[10px] text-amber-300">
                  Select both dates to run a custom window.
                </div>
              )}
              <div className="col-span-2 text-[10px] text-slate-500">
                Note: “To” is treated as inclusive in the UI.
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
          <div className="text-xs text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <MapPin size={14} className="text-slate-400" />
            Location
          </div>

          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase">Country</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value as any)}
              className="mt-1 w-full bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
            >
              <option value="DE">DE</option>
              <option value="AT">AT</option>
            </select>
            <div className="text-[10px] text-slate-600 mt-1">aWATTar is country-based (DE/AT).</div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
          <div className="text-xs text-slate-400 font-semibold mb-3 flex items-center gap-2">
            <Sliders size={14} className="text-slate-400" />
            Price add-ons
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase">Surcharge (ct/kWh)</label>
              <input
                type="number"
                step="0.1"
                value={surchargeCt}
                onChange={e => setSurchargeCt(Number(e.target.value))}
                className="mt-1 w-full bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="text-[10px] text-slate-600 mt-1">
                Added to the market price before VAT. Typical use: fees, margin, balancing costs, etc.
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase">VAT (%)</label>
              <input
                type="number"
                step="0.1"
                value={vatPercent}
                onChange={e => setVatPercent(Number(e.target.value))}
                className="mt-1 w-full bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="text-[10px] text-slate-600 mt-1">
                Applied on top: (market + surcharge) × (1 + VAT).
              </div>
            </div>
            <div className="col-span-2 text-[10px] text-slate-600">
              Tip: set VAT to 20% (AT) / 19% (DE). Example: market 10ct + surcharge 5ct @ 19% VAT ⇒ ~17.85ct/kWh.
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-5">
        {error && (
          <div className="bg-red-900/30 border border-red-700/40 text-red-200 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="bg-slate-900/40 border border-slate-700/50 text-slate-400 p-4 rounded-xl text-sm">
            Run the comparison to see how much you would have paid with a dynamic tariff.
          </div>
        )}

        {result && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Fixed net cost</div>
                <div className="text-2xl font-bold text-slate-100 mt-1">
                  {currencySymbol} {result.totals.fixed.net.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Import − feed-in revenue</div>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Dynamic net cost</div>
                <div className="text-2xl font-bold text-slate-100 mt-1">
                  {currencySymbol} {result.totals.dynamic.net.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">aWATTar + add-ons</div>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Difference</div>
                <div className={`text-2xl font-bold mt-1 flex items-center gap-2 ${summary.delta <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {summary.delta <= 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                  {currencySymbol} {summary.delta.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {summary.delta <= 0 ? `You would have saved ~${currencySymbol} ${summary.savings.toFixed(2)}` : `You would have paid ~${currencySymbol} ${summary.extra.toFixed(2)} more`}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span className="bg-slate-900/60 border border-slate-700/50 px-2 py-1 rounded">
                Range: {result.range.from.substring(0, 10)} → {result.range.to.substring(0, 10)}
              </span>
              <span className="bg-slate-900/60 border border-slate-700/50 px-2 py-1 rounded">
                Coverage: {summary.coverage}% ({result.coverage.hoursUsed}/{result.coverage.hoursWithEnergy} hours)
              </span>
              <span className="bg-slate-900/60 border border-slate-700/50 px-2 py-1 rounded">
                Assumptions: +{(result as any).assumptions.surchargeCt}ct, VAT {(result as any).assumptions.vatPercent}%
              </span>
            </div>

            <div className="bg-slate-900/20 border border-slate-700/50 rounded-2xl p-4 h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatTickDate} stroke="#94a3b8" fontSize={11} tickLine={false} dy={10} minTickGap={24} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#334155', opacity: 0.35 }} isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="fixedNet" name="Fixed" fill="#60A5FA" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="dynamicNet" name="Dynamic" fill="#A78BFA" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="cumDelta" name="Cum. delta" stroke="#34D399" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DynamicTariffComparison;
