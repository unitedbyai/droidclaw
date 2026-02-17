import type { ServerWebSocket } from "bun";
import type { DeviceInfo, DashboardMessage } from "@droidclaw/shared";

/** Data attached to each WebSocket connection by Bun.serve upgrade */
export interface WebSocketData {
  path: "/ws/device" | "/ws/dashboard";
  userId?: string;
  deviceId?: string;
  /** Persistent device ID from the `device` DB table (survives reconnects) */
  persistentDeviceId?: string;
  authenticated: boolean;
}

/** A connected Android device */
export interface ConnectedDevice {
  deviceId: string;
  persistentDeviceId?: string;
  userId: string;
  ws: ServerWebSocket<WebSocketData>;
  deviceInfo?: DeviceInfo;
  connectedAt: Date;
}

/** A dashboard client subscribed to real-time updates */
export interface DashboardSubscriber {
  userId: string;
  ws: ServerWebSocket<WebSocketData>;
}

/** A pending request waiting for a device response */
export interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30 seconds

class SessionManager {
  private devices = new Map<string, ConnectedDevice>();
  private dashboardSubscribers = new Set<DashboardSubscriber>();
  private pendingRequests = new Map<string, PendingRequest>();

  // ── Device management ──────────────────────────────────

  addDevice(device: ConnectedDevice): void {
    this.devices.set(device.deviceId, device);
  }

  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    // Note: pending requests for this device will time out naturally
    // since we can't map requestId → deviceId without extra bookkeeping.
  }

  getDevice(deviceId: string): ConnectedDevice | undefined {
    return this.devices.get(deviceId);
  }

  /** Look up a device by its persistent DB ID (survives reconnects) */
  getDeviceByPersistentId(persistentId: string): ConnectedDevice | undefined {
    for (const device of this.devices.values()) {
      if (device.persistentDeviceId === persistentId) {
        return device;
      }
    }
    return undefined;
  }

  getDevicesForUser(userId: string): ConnectedDevice[] {
    const result: ConnectedDevice[] = [];
    for (const device of this.devices.values()) {
      if (device.userId === userId) {
        result.push(device);
      }
    }
    return result;
  }

  getAllDevices(): ConnectedDevice[] {
    return Array.from(this.devices.values());
  }

  // ── Dashboard subscriber management ───────────────────

  addDashboardSubscriber(sub: DashboardSubscriber): void {
    this.dashboardSubscribers.add(sub);
  }

  removeDashboardSubscriber(ws: ServerWebSocket<WebSocketData>): void {
    for (const sub of this.dashboardSubscribers) {
      if (sub.ws === ws) {
        this.dashboardSubscribers.delete(sub);
        break;
      }
    }
  }

  /** Send a JSON message to all dashboard subscribers for a given user */
  notifyDashboard(userId: string, message: DashboardMessage): void {
    const payload = JSON.stringify(message);
    for (const sub of this.dashboardSubscribers) {
      if (sub.userId === userId) {
        try {
          sub.ws.send(payload);
        } catch {
          // subscriber disconnected; will be cleaned up on close
        }
      }
    }
  }

  // ── Request/response pattern for device commands ──────

  /**
   * Send a command to a device and wait for its response.
   * Returns a Promise that resolves when the device sends back
   * a message with a matching requestId.
   */
  sendCommand(
    deviceId: string,
    command: Record<string, unknown>,
    timeout = DEFAULT_COMMAND_TIMEOUT
  ): Promise<unknown> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return Promise.reject(new Error(`Device ${deviceId} not connected`));
    }

    const requestId =
      command.requestId as string | undefined ??
      crypto.randomUUID();

    const commandWithId = { ...command, requestId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        device.ws.send(JSON.stringify(commandWithId));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to send command to device: ${err}`));
      }
    });
  }

  /** Resolve a pending request when a device responds */
  resolveRequest(requestId: string, data: unknown): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(data);
    return true;
  }

  /** Get counts for monitoring */
  getStats() {
    return {
      devices: this.devices.size,
      dashboardSubscribers: this.dashboardSubscribers.size,
      pendingRequests: this.pendingRequests.size,
    };
  }
}

export const sessions = new SessionManager();
