import { query, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { device, agentSession, agentStep } from '$lib/server/db/schema';
import { eq, desc, and, count, avg, sql } from 'drizzle-orm';

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
					.where(sql`${agentSession.deviceId} IN ${deviceIds}`)
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

export const getDeviceStats = query(async (deviceId: string) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;

	const stats = await db
		.select({
			totalSessions: count(agentSession.id),
			successCount: count(sql`CASE WHEN ${agentSession.status} = 'completed' THEN 1 END`),
			avgSteps: avg(agentSession.stepsUsed)
		})
		.from(agentSession)
		.where(and(eq(agentSession.deviceId, deviceId), eq(agentSession.userId, locals.user.id)));

	const lastSession = await db
		.select({
			goal: agentSession.goal,
			status: agentSession.status,
			startedAt: agentSession.startedAt
		})
		.from(agentSession)
		.where(and(eq(agentSession.deviceId, deviceId), eq(agentSession.userId, locals.user.id)))
		.orderBy(desc(agentSession.startedAt))
		.limit(1);

	const s = stats[0];
	return {
		totalSessions: Number(s?.totalSessions ?? 0),
		successRate: s?.totalSessions
			? Math.round((Number(s.successCount) / Number(s.totalSessions)) * 100)
			: 0,
		avgSteps: Math.round(Number(s?.avgSteps ?? 0)),
		lastGoal: lastSession[0] ?? null
	};
});

export const listDeviceSessions = query(async (deviceId: string) => {
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

export const listSessionSteps = query(async ({ deviceId, sessionId }: { deviceId: string; sessionId: string }) => {
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
});
