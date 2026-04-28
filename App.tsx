
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Settings, RefreshCw, AlertCircle, Sun, Battery, Zap, Home, Download, Moon } from 'lucide-react';
import Dashboard from './components/Dashboard';
import SettingsModal from './components/SettingsModal';
import { useToast } from './components/Toaster';
import { useI18n } from './services/i18n';
import { InverterData, SystemConfig, SystemInfo } from './types';
import { getRealtimeData, getConfig, saveConfig, getSystemInfo } from './services/api';
import { addThemeListener, getThemeMode, resolveTheme, setThemeMode, type ThemeMode } from './services/uiPreferences';

const App: React.FC = () => {
  const { push } = useToast();
  const { t } = useI18n();
  const [data, setData] = useState<InverterData | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'general' | 'notifications' | 'tariffs' | 'expenses' | 'appliances' | 'history' | 'import' | undefined
  >(undefined);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  
  // Trigger to force dashboard refresh after settings change
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const fetchData = useCallback(async () => {
    try {
      if (!config?.inverterIp) {
        // Don't fetch if no IP configured, but stop loading
        setLoading(false);
        return;
      }

      const result = await getRealtimeData();
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to connect to backend or inverter.");
    } finally {
      setLoading(false);
    }
  }, [config]);

  // Initial Config & System Info Load
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const cfg = await getConfig();
        setConfig(cfg);
        if (!cfg.inverterIp) {
          setIsSettingsOpen(true);
        }
      } catch (e) {
        console.error("Failed to load config", e);
        setError("Could not load system configuration.");
      }
    };
    
    const loadSystemInfo = async () => {
      try {
        const info = await getSystemInfo();
        setSystemInfo(info);
      } catch (e) {
        console.error("Failed to load system info", e);
      }
    };

    loadConfig();
    loadSystemInfo();
  }, []);

  // Polling Interval
  useEffect(() => {
    if (!config?.inverterIp) return;

    fetchData(); // Initial fetch
    const interval = setInterval(fetchData, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [config, fetchData]);

  useEffect(() => {
    // Keep in sync with SettingsModal changes.
    return addThemeListener(() => setThemeModeState(getThemeMode()));
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(themeMode), [themeMode]);

  const themeUi = useMemo(() => {
    if (resolvedTheme === 'dark') return { label: t('Dark'), icon: <Moon size={20} /> };
    return { label: t('Light'), icon: <Sun size={20} /> };
  }, [resolvedTheme, t]);

  const toggleTheme = () => {
    const next: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeModeState(next);
    setThemeMode(next);
  };

  const handleSaveConfig = async (newConfig: SystemConfig) => {
    try {
      await saveConfig(newConfig);
      setConfig(newConfig);
      setIsSettingsOpen(false);
      // Force immediate refresh of realtime data
      setLoading(true);
      setTimeout(fetchData, 1000); 
      // Force refresh of expensive calculations (ROI/History) in Dashboard
      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.error(e);
      push({ type: 'error', title: t('Save failed'), message: t('Failed to save settings. Please try again.') });
    }
  };

  const openSettings = (tab?: 'general' | 'notifications' | 'tariffs' | 'expenses' | 'appliances' | 'history' | 'import') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 selection:bg-yellow-500 selection:text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-yellow-500 p-2 rounded-lg text-slate-900">
                <Sun size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                    SunFlow <span className="text-slate-500 font-normal">Gen24</span>
                    {systemInfo && (
                         <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">v{systemInfo.version}</span>
                    )}
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className={`inline-block w-2 h-2 rounded-full ${error ? 'bg-red-500' : 'bg-green-500'}`}></span>
                  {error ? t('System Offline') : t('System Operational')}
                  
                  {systemInfo?.updateAvailable && (
                    <a 
                        href={systemInfo.releaseUrl || '#'} 
                        target="_blank" 
                        rel="noreferrer"
                        className="ml-2 flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors bg-blue-900/30 px-2 py-0.5 rounded-full border border-blue-800/50"
                    >
                        <Download size={10} />
                        {t('New:')} v{systemInfo.latestVersion}
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end text-xs text-slate-400">
                <span>{t('Last Updated')}</span>
                <span className="text-slate-300">{lastUpdated.toLocaleTimeString()}</span>
              </div>

              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
                aria-label={`${t('Theme:')} ${themeUi.label}. ${t('Click to switch.')}`}
              >
                {themeUi.icon}
              </button>
              
              <button 
                onClick={() => fetchData()}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
                aria-label={t('Refresh Data')}
              >
                <RefreshCw size={20} />
              </button>
              
              <button 
                onClick={() => openSettings()}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
                aria-label={t('Settings')}
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 text-slate-500">
            <RefreshCw className="animate-spin" size={48} />
            <p>{t('Connecting to Fronius Inverter...')}</p>
          </div>
        ) : !config?.inverterIp ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 text-slate-400">
            <Settings size={48} />
            <p className="text-lg">{t('Please configure your Inverter IP in settings.')}</p>
            <button 
              onClick={() => openSettings('general')}
              className="px-4 py-2 bg-yellow-500 text-slate-900 font-bold rounded hover:bg-yellow-400 transition"
            >
              {t('Open Settings')}
            </button>
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 text-slate-400 text-center">
            <AlertCircle size={48} className="text-red-400" />
            <div className="space-y-1">
              <p className="text-lg text-slate-200">{error || t('Failed to connect to backend or inverter.')}</p>
              <p className="text-sm text-slate-500">{t('Check inverter reachability and your saved connection settings.')}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  setLoading(true);
                  fetchData();
                }}
                className="px-4 py-2 bg-slate-800 text-slate-100 font-semibold rounded border border-slate-700 hover:bg-slate-700 transition"
              >
                {t('Retry connection')}
              </button>
              <button
                onClick={() => openSettings('general')}
                className="px-4 py-2 bg-yellow-500 text-slate-900 font-bold rounded hover:bg-yellow-400 transition"
              >
                {t('Open Settings')}
              </button>
            </div>
          </div>
        ) : (
          <Dashboard 
            data={data} 
            config={config} 
            error={error} 
            refreshTrigger={refreshTrigger}
            onOpenSettings={openSettings}
          />
        )}
      </main>

      {/* Modals */}
      {isSettingsOpen && (
        <SettingsModal 
          currentConfig={config || { inverterIp: '', currency: 'EUR', systemStartDate: new Date().toISOString().split('T')[0] }} 
          onSave={handleSaveConfig} 
          onClose={() => setIsSettingsOpen(false)} 
          initialTab={settingsInitialTab}
        />
      )}
    </div>
  );
};

export default App;