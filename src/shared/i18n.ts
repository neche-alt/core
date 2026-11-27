export type SupportedLocale = "en" | "es";

export type MessageKey =
  | "wallet.connect.failed"
  | "wallet.device.verification_required"
  | "transaction.invalid"
  | "transaction.amount_positive"
  | "transaction.fee_unavailable"
  | "network.unavailable"
  | "escrow.invalid_state"
  | "escrow.timelock_expired"
  // ── Example app UI strings (react-wallet-connect) ─────────────────────────
  | "ui.app.title"
  | "ui.wallet.connect_button"
  | "ui.wallet.connecting"
  | "ui.wallet.connected_label"
  | "ui.wallet.disconnect_button"
  | "ui.wallet.refresh_balances"
  | "ui.balances.heading"
  | "ui.balances.asset_column"
  | "ui.balances.balance_column"
  | "ui.payment.heading"
  | "ui.payment.destination_label"
  | "ui.payment.destination_placeholder"
  | "ui.payment.amount_label"
  | "ui.payment.amount_placeholder"
  | "ui.payment.send_button"
  | "ui.payment.sending"
  | "ui.payment.connect_first"
  // ── Example app UI strings (transaction-dashboard) ────────────────────────
  | "ui.dashboard.heading"
  | "ui.dashboard.success_rate"
  | "ui.dashboard.avg_fee"
  | "ui.dashboard.avg_confirmation"
  | "ui.dashboard.unavailable"
  | (string & {});

export type TranslationCatalog = Partial<Record<MessageKey, string>>;
export type TranslationMap = Record<string, TranslationCatalog>;

export interface I18nConfig {
  locale?: string;
  translations?: TranslationMap;
}

export interface I18n {
  readonly locale: string;
  translate(key: MessageKey, variables?: Record<string, string | number>): string;
  t(key: MessageKey, variables?: Record<string, string | number>): string;
  withLocale(locale: string): I18n;
  withTranslations(translations: TranslationMap): I18n;
}

export const DEFAULT_LOCALE = "en";

export const EN_TRANSLATIONS: Required<TranslationCatalog> = {
  "wallet.connect.failed": "Unable to connect to the wallet.",
  "wallet.device.verification_required": "Additional verification is required for this device.",
  "transaction.invalid": "The transaction is invalid.",
  "transaction.amount_positive": "The amount must be positive.",
  "transaction.fee_unavailable": "A transaction fee estimate is unavailable.",
  "network.unavailable": "The network is currently unavailable.",
  "escrow.invalid_state": "The escrow cannot perform this action in its current state.",
  "escrow.timelock_expired": "The escrow timelock has expired.",
  // ── Example app UI strings (react-wallet-connect) ─────────────────────────
  "ui.app.title": "sorokit-core — React wallet",
  "ui.wallet.connect_button": "Connect Freighter",
  "ui.wallet.connecting": "Connecting…",
  "ui.wallet.connected_label": "Connected:",
  "ui.wallet.disconnect_button": "Disconnect",
  "ui.wallet.refresh_balances": "Refresh balances",
  "ui.balances.heading": "Balances",
  "ui.balances.asset_column": "Asset",
  "ui.balances.balance_column": "Balance",
  "ui.payment.heading": "Send XLM",
  "ui.payment.destination_label": "Destination",
  "ui.payment.destination_placeholder": "G...",
  "ui.payment.amount_label": "Amount (XLM)",
  "ui.payment.amount_placeholder": "10",
  "ui.payment.send_button": "Send",
  "ui.payment.sending": "Sending…",
  "ui.payment.connect_first": "Connect a wallet first",
  // ── Example app UI strings (transaction-dashboard) ────────────────────────
  "ui.dashboard.heading": "Transactions",
  "ui.dashboard.success_rate": "Success rate",
  "ui.dashboard.avg_fee": "Avg fee",
  "ui.dashboard.avg_confirmation": "Avg confirmation",
  "ui.dashboard.unavailable": "—",
};

export const ES_TRANSLATIONS: Required<TranslationCatalog> = {
  "wallet.connect.failed": "No se puede conectar con la billetera.",
  "wallet.device.verification_required": "Se requiere verificación adicional para este dispositivo.",
  "transaction.invalid": "La transacción no es válida.",
  "transaction.amount_positive": "El importe debe ser positivo.",
  "transaction.fee_unavailable": "No hay una estimación de comisión disponible.",
  "network.unavailable": "La red no está disponible actualmente.",
  "escrow.invalid_state": "El depósito no puede realizar esta acción en su estado actual.",
  "escrow.timelock_expired": "El bloqueo temporal del depósito ha expirado.",
  // ── Example app UI strings (react-wallet-connect) ─────────────────────────
  "ui.app.title": "sorokit-core — Cartera React",
  "ui.wallet.connect_button": "Conectar Freighter",
  "ui.wallet.connecting": "Conectando…",
  "ui.wallet.connected_label": "Conectado:",
  "ui.wallet.disconnect_button": "Desconectar",
  "ui.wallet.refresh_balances": "Actualizar saldos",
  "ui.balances.heading": "Saldos",
  "ui.balances.asset_column": "Activo",
  "ui.balances.balance_column": "Saldo",
  "ui.payment.heading": "Enviar XLM",
  "ui.payment.destination_label": "Destino",
  "ui.payment.destination_placeholder": "G...",
  "ui.payment.amount_label": "Cantidad (XLM)",
  "ui.payment.amount_placeholder": "10",
  "ui.payment.send_button": "Enviar",
  "ui.payment.sending": "Enviando…",
  "ui.payment.connect_first": "Primero conecta una cartera",
  // ── Example app UI strings (transaction-dashboard) ────────────────────────
  "ui.dashboard.heading": "Transacciones",
  "ui.dashboard.success_rate": "Tasa de éxito",
  "ui.dashboard.avg_fee": "Comisión media",
  "ui.dashboard.avg_confirmation": "Confirmación media",
  "ui.dashboard.unavailable": "—",
};

const BUILTIN_TRANSLATIONS: TranslationMap = { en: EN_TRANSLATIONS, es: ES_TRANSLATIONS };

function interpolate(value: string, variables?: Record<string, string | number>): string {
  if (!variables) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match,
  );
}

function normalizeLocale(locale?: string): string {
  return (locale || DEFAULT_LOCALE).trim().toLowerCase().replace(/_/g, "-").split("-")[0] || DEFAULT_LOCALE;
}

export function createI18n(config: I18nConfig = {}): I18n {
  const locale = normalizeLocale(config.locale);
  const custom = config.translations ?? {};
  const translate = (key: MessageKey, variables?: Record<string, string | number>): string => {
    const value = custom[locale]?.[key] ?? BUILTIN_TRANSLATIONS[locale]?.[key] ?? custom[DEFAULT_LOCALE]?.[key] ?? EN_TRANSLATIONS[key];
    return interpolate(value ?? String(key), variables);
  };
  return {
    locale,
    translate,
    t: translate,
    withLocale: (nextLocale) => createI18n({
      locale: nextLocale,
      ...(Object.keys(custom).length > 0 ? { translations: custom } : {}),
    }),
    withTranslations: (translations) => createI18n({
      locale,
      translations: { ...custom, ...translations },
    }),
  };
}

export function translateMessage(
  key: MessageKey,
  locale?: string,
  translations?: TranslationMap,
  variables?: Record<string, string | number>,
): string {
  return createI18n({
    ...(locale !== undefined ? { locale } : {}),
    ...(translations !== undefined ? { translations } : {}),
  }).translate(key, variables);
}

export interface LocalizedError {
  code: string;
  message: string;
  cause?: unknown;
}

/** Localize presentation text without ever changing the machine-readable code. */
export function localizeError(
  error: LocalizedError,
  i18n: I18n,
  messageKey?: MessageKey,
  variables?: Record<string, string | number>,
): LocalizedError {
  return { ...error, message: messageKey ? i18n.translate(messageKey, variables) : error.message };
}
