import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  addLanguageListener,
  getLanguageMode,
  resolveLanguage,
  setLanguageMode,
  type LanguageMode,
} from './uiPreferences';

type ResolvedLanguage = 'en' | 'de';

// Key strategy: use the English UI string as the key.
// This keeps the migration friction low (wrap UI literals in t('...')).
const DE: Record<string, string> = {
  'System Settings': 'Systemeinstellungen',
  'Settings': 'Einstellungen',
  'Open Settings': 'Einstellungen öffnen',
  'Refresh Data': 'Daten aktualisieren',
  'Last Updated': 'Zuletzt aktualisiert',
  'System Offline': 'System offline',
  'System Operational': 'System bereit',
  'Connecting to Fronius Inverter...': 'Verbinde mit Fronius Wechselrichter...',
  'Please configure your Inverter IP in settings.': 'Bitte Inverter-IP in den Einstellungen konfigurieren.',

  'Invalid export cap': 'Ungültiges Export-Limit',
  'Please enter a positive export cap in watts, or switch to “Off (100%)” / “Estimated”.': 'Bitte ein positives Export-Limit in Watt eingeben oder auf „Aus (100%)“ / „Geschätzt“ umstellen.',

  'Please enter a Discord Webhook URL first.': 'Bitte zuerst eine Discord-Webhook-URL eintragen.',
  'Missing webhook': 'Webhook fehlt',
  'Enter and save a Discord Webhook URL first.': 'Bitte zuerst eine Discord-Webhook-URL eintragen und speichern.',
  'Save required': 'Speichern erforderlich',
  'Please save settings first, then test the notification.': 'Bitte zuerst die Einstellungen speichern und dann die Benachrichtigung testen.',
  'Sent': 'Gesendet',
  'Test notification sent. Check your Discord channel.': 'Testbenachrichtigung gesendet. Bitte den Discord-Channel prüfen.',
  'Send failed': 'Senden fehlgeschlagen',
  'Failed to send test notification. Check the URL and server logs.': 'Testbenachrichtigung konnte nicht gesendet werden. Bitte URL und Server-Logs prüfen.',

  'General': 'Allgemein',
  'Notifications': 'Benachrichtigungen',
  'Appliances': 'Geräte',
  'Tariffs': 'Tarife',
  'Expenses': 'Ausgaben',
  'Calibration': 'Kalibrierung',
  'Data Import': 'Datenimport',

  'Appearance': 'Darstellung',
  'Theme': 'Design',
  'Language': 'Sprache',
  'System': 'System',
  'Dark': 'Dunkel',
  'Light': 'Hell',
  'English': 'Englisch',
  'Deutsch': 'Deutsch',

  'Connection & Date': 'Verbindung & Datum',
  'Inverter IP Address': 'Inverter IP-Adresse',
  'System Start Date': 'System-Startdatum',
  'Used to calculate the timeline for recurring costs.': 'Wird für die Zeitachse wiederkehrender Kosten verwendet.',
  'Currency Symbol': 'Währung',
  'Location & Capacity': 'Standort & Leistung',
  'Latitude': 'Breitengrad',
  'Longitude': 'Längengrad',
  'Solar Capacity (kWp)': 'PV-Leistung (kWp)',
  'Battery Size (kWh)': 'Batteriegröße (kWh)',
  'e.g. 10.5': 'z.B. 10,5',
  'e.g. 7.7': 'z.B. 7,7',

  'Grid Export': 'Netzeinspeisung',
  'Export cap': 'Einspeiselimit',
  'Estimated (from history)': 'Geschätzt (aus Historie)',
  'Off (100%)': 'Aus (100%)',
  'Fixed (W)': 'Fix (W)',
  'Controls export limitation used in the Scenario Planner upgrade simulator.': 'Steuert das Einspeiselimit, das im Upgrade-Simulator (Szenario) verwendet wird.',
  'Fixed cap (W)': 'Fixes Limit (W)',
  'e.g. 5350': 'z.B. 5350',
  'Tip: If you want no export limit (older installations / other regions), choose “Off (100%)”.': 'Tipp: Wenn du kein Einspeiselimit möchtest (ältere Anlagen / andere Regionen), wähle „Aus (100%)“.',

  'Smart Usage': 'Intelligente Nutzung',
  'Battery Reserve (%)': 'Batterie-Reserve (%)',

  'Solcast API (Forecasting)': 'Solcast API (Prognose)',
  'Required for Smart Recommendations. Create a free account at': 'Erforderlich für Smart Recommendations. Kostenlosen Account erstellen bei',
  'and create a "Rooftop Site".': 'und dort eine „Rooftop Site“ anlegen.',
  'API Key': 'API-Schlüssel',
  'Site Resource ID': 'Site Resource ID',
  'The ID from your Solcast dashboard (e.g. 5a31...). You can also just paste the full "Resource Link" here, and we\'ll extract the ID automatically.': 'Die ID aus deinem Solcast-Dashboard (z.B. 5a31...). Du kannst hier auch einfach den kompletten „Resource Link“ einfügen – die ID wird automatisch extrahiert.',

  'Save Settings': 'Einstellungen speichern',
  'Discord Integration': 'Discord-Integration',
  'Enable': 'Aktiv',
  'Enable notifications': 'Benachrichtigungen aktivieren',
};

type I18nContextValue = {
  language: ResolvedLanguage;
  languageMode: LanguageMode;
  setLanguageMode: (mode: LanguageMode) => void;
  t: (english: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [languageModeState, setLanguageModeState] = useState<LanguageMode>(() => getLanguageMode());
  const [language, setLanguage] = useState<ResolvedLanguage>(() => resolveLanguage(getLanguageMode()));

  useEffect(() => {
    const refresh = () => {
      const mode = getLanguageMode();
      setLanguageModeState(mode);
      setLanguage(resolveLanguage(mode));
    };
    const dispose = addLanguageListener(refresh);
    return dispose;
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const t = (english: string) => {
      if (language === 'de') return DE[english] ?? english;
      return english;
    };

    return {
      language,
      languageMode: languageModeState,
      setLanguageMode: (mode) => setLanguageMode(mode),
      t,
    };
  }, [language, languageModeState]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;

  // Fallback (tests / isolated renders)
  const mode = getLanguageMode();
  const language = resolveLanguage(mode);
  return {
    language,
    languageMode: mode,
    setLanguageMode: (m) => setLanguageMode(m),
    t: (english) => (language === 'de' ? (DE[english] ?? english) : english),
  };
}
