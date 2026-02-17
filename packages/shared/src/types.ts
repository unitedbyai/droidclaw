export interface UIElement {
  id: string;
  text: string;
  type: string;
  bounds: string;
  center: [number, number];
  size: [number, number];
  clickable: boolean;
  editable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
  selected: boolean;
  scrollable: boolean;
  longClickable: boolean;
  password: boolean;
  hint: string;
  action: "tap" | "type" | "longpress" | "scroll" | "read";
  parent: string;
  depth: number;
}

export interface ActionDecision {
  action: string;
  coordinates?: [number, number];
  text?: string;
  direction?: string;
  reason?: string;
  package?: string;
  activity?: string;
  uri?: string;
  extras?: Record<string, string>;
  command?: string;
  filename?: string;
  think?: string;
  plan?: string[];
  planProgress?: string;
  skill?: string;
  query?: string;
  url?: string;
  path?: string;
  source?: string;
  dest?: string;
  code?: number;
  setting?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: string;
}

export interface DeviceInfo {
  model: string;
  androidVersion: string;
  screenWidth: number;
  screenHeight: number;
}

export interface ScreenState {
  elements: UIElement[];
  screenshot?: string;
  packageName?: string;
  fallbackReason?: string;
}
