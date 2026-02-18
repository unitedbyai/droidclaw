import * as v from 'valibot';
import { query, command, getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { device, agentSession, agentStep } from '$lib/server/db/schema';
import { eq, desc, and, count, avg, sql, inArray } from 'drizzle-orm';

export const listDevices = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) return [];

	const devices = await db
		.select()
		.from(device)
		.where(eq(device.userId, locals.user.id))
		.orderBy(desc(device.lastSeen));

	// Get last session for each device
	const deviceIds = devices.map((d) => d.id);
	const lastSessions =
		deviceIds.length > 0
			? await db
					.select({
						deviceId: agentSession.deviceId,
						goal: agentSession.goal,
						status: agentSession.status,
						startedAt: agentSession.startedAt
					})
					.from(agentSession)
					.where(inArray(agentSession.deviceId, deviceIds))
					.orderBy(desc(agentSession.startedAt))
			: [];

	// Group last session per device (first occurrence = latest due to ORDER BY)
	const lastSessionMap = new Map<string, (typeof lastSessions)[0]>();
	for (const s of lastSessions) {
		if (!lastSessionMap.has(s.deviceId)) {
			lastSessionMap.set(s.deviceId, s);
		}
	}

	return devices.map((d) => {
		const info = d.deviceInfo as Record<string, unknown> | null;
		const last = lastSessionMap.get(d.id);
		return {
			deviceId: d.id,
			name: d.name,
			status: d.status,
			model: (info?.model as string) ?? null,
			manufacturer: (info?.manufacturer as string) ?? null,
			androidVersion: (info?.androidVersion as string) ?? null,
			screenWidth: (info?.screenWidth as number) ?? null,
			screenHeight: (info?.screenHeight as number) ?? null,
			batteryLevel: (info?.batteryLevel as number) ?? null,
			isCharging: (info?.isCharging as boolean) ?? false,
			lastSeen: d.lastSeen?.toISOString() ?? d.createdAt.toISOString(),
			lastGoal: last
				? { goal: last.goal, status: last.status, startedAt: last.startedAt.toISOString() }
				: null
		};
	});
});

export const getDevice = query(v.string(), async (deviceId) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;

	const rows = await db
		.select()
		.from(device)
		.where(and(eq(device.id, deviceId), eq(device.userId, locals.user.id)))
		.limit(1);

	if (rows.length === 0) return null;

	const d = rows[0];
	const info = d.deviceInfo as Record<string, unknown> | null;
	return {
		deviceId: d.id,
		name: d.name,
		status: d.status,
		model: (info?.model as string) ?? null,
		manufacturer: (info?.manufacturer as string) ?? null,
		androidVersion: (info?.androidVersion as string) ?? null,
		screenWidth: (info?.screenWidth as number) ?? null,
		screenHeight: (info?.screenHeight as number) ?? null,
		batteryLevel: (info?.batteryLevel as number) ?? null,
		isCharging: (info?.isCharging as boolean) ?? false,
		lastSeen: d.lastSeen?.toISOString() ?? d.createdAt.toISOString(),
		installedApps: (info?.installedApps as Array<{ packageName: string; label: string }>) ?? []
	};
});

export const getDeviceStats = query(v.string(), async (deviceId) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;

	try {
		const stats = await db
			.select({
				totalSessions: count(agentSession.id),
				successCount: count(sql`CASE WHEN ${agentSession.status} = 'completed' THEN 1 END`),
				avgSteps: avg(agentSession.stepsUsed)
			})
			.from(agentSession)
			.where(and(eq(agentSession.deviceId, deviceId), eq(agentSession.userId, locals.user.id)));

		const s = stats[0];
		return {
			totalSessions: Number(s?.totalSessions ?? 0),
			successRate: s?.totalSessions
				? Math.round((Number(s.successCount) / Number(s.totalSessions)) * 100)
				: 0,
			avgSteps: Math.round(Number(s?.avgSteps ?? 0))
		};
	} catch (err) {
		console.error('[getDeviceStats] Query failed:', err);
		return { totalSessions: 0, successRate: 0, avgSteps: 0 };
	}
});

export const listDeviceSessions = query(v.string(), async (deviceId) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return [];

	const sessions = await db
		.select()
		.from(agentSession)
		.where(and(eq(agentSession.deviceId, deviceId), eq(agentSession.userId, locals.user.id)))
		.orderBy(desc(agentSession.startedAt))
		.limit(50);

	return sessions;
});

export const listSessionSteps = query(
	v.object({ deviceId: v.string(), sessionId: v.string() }),
	async ({ deviceId, sessionId }) => {
		const { locals } = getRequestEvent();
		if (!locals.user) return [];

		// Verify session belongs to user
		const sess = await db
			.select()
			.from(agentSession)
			.where(and(eq(agentSession.id, sessionId), eq(agentSession.userId, locals.user.id)))
			.limit(1);

		if (sess.length === 0) return [];

		const steps = await db
			.select()
			.from(agentStep)
			.where(eq(agentStep.sessionId, sessionId))
			.orderBy(agentStep.stepNumber);

		return steps;
	}
);

// ─── Commands (write operations) ─────────────────────────────

const SERVER_URL = () => env.SERVER_URL || 'http://localhost:8080';
const INTERNAL_SECRET = () => env.INTERNAL_SECRET || '';

/** Forward a request to the DroidClaw server with internal auth */
async function serverFetch(path: string, body: Record<string, unknown>) {
	const { locals } = getRequestEvent();
	if (!locals.user) throw new Error('unauthorized');

	const res = await fetch(`${SERVER_URL()}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-internal-secret': INTERNAL_SECRET(),
			'x-internal-user-id': locals.user.id
		},
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({ error: 'Unknown error' }));
	if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
	return data;
}

export const submitGoal = command(
	v.object({ deviceId: v.string(), goal: v.string() }),
	async ({ deviceId, goal }) => {
		return serverFetch('/goals', { deviceId, goal });
	}
);

export const stopGoal = command(
	v.object({ deviceId: v.string() }),
	async ({ deviceId }) => {
		return serverFetch('/goals/stop', { deviceId });
	}
);
