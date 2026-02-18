/**
 * Centralized Umami analytics event names.
 *
 * Naming convention: {category}-{action}
 * Use these constants everywhere to keep tracking consistent.
 * Umami auto-tracks page views — these are for custom events only.
 */

// ─── Auth ────────────────────────────────────────────
export const AUTH_LOGIN_SUBMIT = 'auth-login-submit';
export const AUTH_LOGIN_SUCCESS = 'auth-login-success';
export const AUTH_SIGNUP_SUBMIT = 'auth-signup-submit';
export const AUTH_SIGNUP_SUCCESS = 'auth-signup-success';
export const AUTH_SIGNOUT = 'auth-signout';

// ─── License / Conversion ────────────────────────────
export const LICENSE_ACTIVATE_CHECKOUT = 'license-activate-checkout';
export const LICENSE_ACTIVATE_MANUAL = 'license-activate-manual';
export const LICENSE_PURCHASE_CLICK = 'license-purchase-click';

// ─── Dashboard ───────────────────────────────────────
export const DASHBOARD_CARD_CLICK = 'dashboard-card-click';

// ─── Devices ─────────────────────────────────────────
export const DEVICE_CARD_CLICK = 'device-card-click';
export const DEVICE_TAB_CHANGE = 'device-tab-change';
export const DEVICE_GOAL_SUBMIT = 'device-goal-submit';
export const DEVICE_GOAL_STOP = 'device-goal-stop';
export const DEVICE_GOAL_COMPLETE = 'device-goal-complete';
export const DEVICE_SESSION_EXPAND = 'device-session-expand';

// ─── API Keys ────────────────────────────────────────
export const APIKEY_CREATE = 'apikey-create';
export const APIKEY_COPY = 'apikey-copy';
export const APIKEY_DELETE = 'apikey-delete';

// ─── Settings ────────────────────────────────────────
export const SETTINGS_SAVE = 'settings-save';

// ─── Navigation ──────────────────────────────────────
export const NAV_SIDEBAR_CLICK = 'nav-sidebar-click';
