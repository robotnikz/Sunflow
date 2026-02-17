import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  addLanguageListener,
  getLanguageMode,
  resolveLanguage,
  setLanguageMode,
  type LanguageMode,
} from './uiPreferences';

type ResolvedLanguage = 'en' | 'de';

function resolveLocale(language: ResolvedLanguage): string {
  return language === 'de' ? 'de-DE' : 'en-US';
}

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

  'Hour': 'Stunde',
  'Day': 'Tag',
  'Week': 'Woche',
  'Month': 'Monat',
  'Year': 'Jahr',
  'Custom': 'Benutzerdefiniert',

  'Setup checklist': 'Einrichtungs-Checkliste',
  'required complete': 'Pflicht erledigt',
  'total': 'gesamt',
  'Open settings': 'Einstellungen öffnen',
  'Dismiss setup checklist': 'Einrichtungs-Checkliste ausblenden',
  'Dismiss': 'Ausblenden',
  'Done': 'Erledigt',
  'Missing': 'Fehlt',
  '(optional)': '(optional)',
  'Fix': 'Beheben',

  'Connected to inverter': 'Mit Wechselrichter verbunden',
  'Required for live data': 'Erforderlich für Live-Daten',
  'Tariffs + expenses + commissioning date': 'Tarife + Ausgaben + Inbetriebnahmedatum',
  'Appliances configured': 'Geräte konfiguriert',
  'Improves smart recommendations': 'Verbessert Smart Recommendations',
  'Location + Solcast API key': 'Standort + Solcast API-Schlüssel',
  'Discord webhook + triggers': 'Discord-Webhook + Trigger',

  'Live Power Flow': 'Live-Leistungsfluss',
  'AUTONOMY': 'AUTARKIE',
  'Grid Independence': 'Netzunabhängigkeit',
  'USAGE': 'NUTZUNG',
  'Solar Utilization': 'Solar-Nutzung',

  'Statistics & Analysis': 'Statistiken & Analyse',
  'Previous Period': 'Vorheriger Zeitraum',
  'Next Period': 'Nächster Zeitraum',
  'You are already viewing the latest available period.': 'Du siehst bereits den aktuellsten verfügbaren Zeitraum.',
  'Latest period': 'Aktuellster Zeitraum',
  'Export CSV': 'CSV exportieren',
  'Export': 'Export',
  'Interval:': 'Zeitraum:',
  'Apply': 'Anwenden',

  'Financial Impact': 'Finanzielle Auswirkung',
  'Total Benefit': 'Gesamtnutzen',
  'Saved Grid Costs + Feed-in Reward': 'Eingesparte Netzstromkosten + Einspeisevergütung',
  'Direct Savings': 'Direkte Ersparnis',
  'Export Earnings': 'Einspeiseerlöse',
  'CO₂ Saved': 'CO₂ gespart',
  'Peak PV': 'PV-Spitze',
  'Energy Totals': 'Energie-Summen',
  'Solar Yield': 'Solarertrag',
  'Imported': 'Bezug',
  'Exported': 'Einspeisung',
  'Max Load': 'Max. Last',
  'Power History': 'Leistungsverlauf',
  'Battery State of Charge': 'Batterieladestand',
  'Efficiency History': 'Effizienzverlauf',
  'Battery Temperature History': 'Batterietemperatur-Verlauf',

  'Add location in settings to see Weather & Solar Forecast.': 'Standort in den Einstellungen hinzufügen, um Wetter & Solarprognose zu sehen.',
  'Local Weather': 'Lokales Wetter',
  'Loading...': 'Lädt...',
  'Total Forecast Today': 'Gesamtprognose heute',
  'Solcast Limit Reached': 'Solcast-Limit erreicht',
  'No Provider': 'Kein Anbieter',
  'Configure Solcast': 'Solcast konfigurieren',

  'Sunny': 'Sonnig',
  'Partly Cloudy': 'Teilweise bewölkt',
  'Foggy': 'Neblig',
  'Rainy': 'Regnerisch',
  'Snowy': 'Schnee',
  'Stormy': 'Stürmisch',

  'No historical data available yet.': 'Noch keine historischen Daten verfügbar.',
  'Watts': 'Watt',
  'Production': 'Produktion',
  'Consumption': 'Verbrauch',
  'Grid': 'Netz',
  'Battery': 'Batterie',
  'Grid Balance': 'Netzbilanz',
  'Grid Power': 'Netzleistung',
  'Charged': 'Geladen',
  'Discharged': 'Entladen',

  'SOLAR': 'SOLAR',
  'HOME LOAD': 'HAUSLAST',
  'CHARGING': 'LÄDT',
  'DRAINING': 'ENTLÄDT',
  'IDLE': 'LEERLAUF',
  'GRID': 'NETZ',

  'Battery Temp:': 'Batterie-Temp.:',
  'n/a': 'k.A.',

  'Waiting for data logs...': 'Warte auf Datenprotokolle...',
  'Long Term': 'Langfristig',
  '1h': '1 Std.',
  '24h': '24 Std.',
  '7 Days': '7 Tage',
  '30 Days': '30 Tage',

  'Errors': 'Fehler',
  'Status': 'Status',
  'Running': 'Läuft',
  'Idle': 'Standby',
  'Active': 'Aktiv',
  'Flawless': 'Fehlerfrei',
  'Running / OK': 'Läuft / OK',
  'Standby / Idle': 'Standby / Leerlauf',

  'Free': 'Frei',
  'Above reserve': 'Über Reserve',
  'Reserve': 'Reserve',
  'Buffering': 'Puffert',
  'Battery Safe': 'Batterie sicher',
  'Battery Priority': 'Batterie hat Priorität',
  'Remaining Solar Forecast Today (Solcast)': 'Verbleibende Solarprognose heute (Solcast)',
  'Forecast data unavailable': 'Prognosedaten nicht verfügbar',
  'Solcast API Limit Reached (Using cached data if available)': 'Solcast API-Limit erreicht (Cache wird verwendet, falls vorhanden)',
  'vs': 'vs',
  'Energy needed to reach your reserve target': 'Energie, die benötigt wird, um dein Reserve-Ziel zu erreichen',

  'Conserve Energy': 'Energie sparen',
  'Not enough sun left today to refill battery if devices run now.': 'Heute bleibt nicht genug Sonne übrig, um die Batterie wieder aufzufüllen, wenn Geräte jetzt laufen.',
  'Charging Storage': 'Speicher lädt',
  'is flowing to battery. Waiting for surplus...': 'fließen in die Batterie. Warte auf Überschuss...',
  'Wait for sun or reduce load.': 'Auf Sonne warten oder Last reduzieren.',

  'Battery Reserve': 'Batteriereserve',
  'Battery Divert': 'Batterie-Umleitung',
  'kWh/run': 'kWh/Lauf',
  'battery': 'Batterie',
  'Need': 'Benötigt',
  'for': 'für',

  'Dynamic Tariff Comparison (aWATTar)': 'Dynamischer Tarifvergleich (aWATTar)',
  'See if a dynamic tariff would have been cheaper': 'Prüfe, ob ein dynamischer Tarif günstiger gewesen wäre',
  'Close': 'Schließen',
  'Dynamic Tariff Comparison': 'Dynamischer Tarifvergleich',
  'aWATTar provides market (exchange) prices. Add “Surcharge” + VAT to approximate your all-in retail tariff.': 'aWATTar liefert Marktpreise (Börse). Ergänze „Aufschlag“ + MwSt., um deinen Endkundenpreis näherungsweise abzubilden.',
  'Calculating…': 'Berechne…',
  'Run comparison': 'Vergleich starten',
  'Time window': 'Zeitraum',
  '7 days': '7 Tage',
  '30 days': '30 Tage',
  '6 months': '6 Monate',
  '12 months': '12 Monate',
  'From': 'Von',
  'To': 'Bis',
  'Select both dates to run a custom window.': 'Bitte beide Daten wählen, um einen benutzerdefinierten Zeitraum zu starten.',
  'Note: “To” is treated as inclusive in the UI.': 'Hinweis: „Bis“ wird in der UI als inklusiv behandelt.',
  'Location': 'Standort',
  'Country': 'Land',
  'aWATTar is country-based (DE/AT).': 'aWATTar ist länderbasiert (DE/AT).',
  'Price add-ons': 'Preisaufschläge',
  'Surcharge (ct/kWh)': 'Aufschlag (ct/kWh)',
  'Added to the market price before VAT. Typical use: fees, margin, balancing costs, etc.': 'Wird vor MwSt. zum Marktpreis addiert. Typisch: Gebühren, Marge, Ausgleichskosten, usw.',
  'VAT (%)': 'MwSt. (%)',
  'VAT': 'MwSt.',
  'Applied on top: (market + surcharge) × (1 + VAT).': 'Wird oben drauf angewendet: (Markt + Aufschlag) × (1 + MwSt.).',
  'Tip: set VAT to 20% (AT) / 19% (DE). Example: market 10ct + surcharge 5ct @ 19% VAT ⇒ ~17.85ct/kWh.': 'Tipp: MwSt. auf 20% (AT) / 19% (DE) setzen. Beispiel: Markt 10ct + Aufschlag 5ct bei 19% MwSt. ⇒ ~17,85ct/kWh.',
  'Run the comparison to see how much you would have paid with a dynamic tariff.': 'Starte den Vergleich, um zu sehen, wie viel du mit einem dynamischen Tarif gezahlt hättest.',
  'Fixed net cost': 'Fixe Nettokosten',
  'Import − feed-in revenue': 'Bezug − Einspeiseerlös',
  'Dynamic net cost': 'Dynamische Nettokosten',
  'aWATTar + add-ons': 'aWATTar + Aufschläge',
  'Difference': 'Differenz',
  'You would have saved ~': 'Du hättest gespart ~',
  'You would have paid ~': 'Du hättest bezahlt ~',
  'more': 'mehr',
  'Range': 'Bereich',
  'Coverage': 'Abdeckung',
  'hours': 'Stunden',
  'Assumptions': 'Annahmen',
  'Fixed': 'Fix',
  'Dynamic': 'Dynamisch',
  'Fixed net': 'Fix netto',
  'Dynamic net': 'Dynamisch netto',
  'Delta (dyn-fixed)': 'Delta (dyn-fix)',
  'Cum. delta': 'Kum. Delta',
  'Failed to load comparison': 'Vergleich konnte nicht geladen werden',

  'Amortization Tracker': 'Amortisations-Tracker',
  'Configure your system costs (Expenses) in settings to track your Return on Investment.': 'Konfiguriere deine Systemkosten (Ausgaben) in den Einstellungen, um deinen Return on Investment zu verfolgen.',
  'Return on Investment': 'Return on Investment',
  'Paid Off': 'Abbezahlt',
  'recovered': 'zurückgewonnen',
  'returned': 'zurück',
  'Invested to date': 'Bisher investiert',
  'Net Profit': 'Nettogewinn',
  'Estimated Break-even': 'Geschätzter Break-even',
  'Total Cost at Break-even': 'Gesamtkosten beim Break-even',
  'Need more data for forecast...': 'Für die Prognose werden mehr Daten benötigt…',

  'Battery Health': 'Batteriezustand',
  'Not enough data yet. Requires full charge cycles to calculate SOH and efficiency.': 'Noch nicht genug Daten. Für SOH und Effizienz werden vollständige Ladezyklen benötigt.',
  'Excellent': 'Ausgezeichnet',
  'Good': 'Gut',
  'Degrading': 'Verschleiß',
  'Poor': 'Schlecht',
  'Battery Health (SOH)': 'Batteriezustand (SOH)',
  'Based on': 'Basierend auf',
  'estimated cycles': 'geschätzten Zyklen',
  'Efficiency': 'Effizienz',
  'Est. Cap': 'Kapazität',
  'Rated': 'Nennwert',
  'Est. Capacity': 'Gesch. Kapazität',

  'Storage': 'Speicher',
  'Standby': 'Standby',
  'Charging': 'Lädt',
  'Discharging': 'Entlädt',
  'Full in': 'Voll in',
  'Empty in': 'Leer in',
  'incl.': 'inkl.',
  'reserve': 'Reserve',
  'Calculated based on current load': 'Basierend auf aktueller Last berechnet',
  'Battery temperature unavailable': 'Batterietemperatur nicht verfügbar',
};

type I18nContextValue = {
  language: ResolvedLanguage;
  locale: string;
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
      locale: resolveLocale(language),
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
    locale: resolveLocale(language),
    languageMode: mode,
    setLanguageMode: (m) => setLanguageMode(m),
    t: (english) => (language === 'de' ? (DE[english] ?? english) : english),
  };
}
