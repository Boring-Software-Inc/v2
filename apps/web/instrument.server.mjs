import { init } from "@sentry/node";

init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.UNKEY_ENVIRONMENT_SLUG || process.env.NODE_ENV,
	release: process.env.UNKEY_GIT_COMMIT_SHA || undefined,
	tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
	dataCollection: {
		userInfo: false,
		cookies: false,
		httpHeaders: { allow: ["user-agent", "content-type", "accept"] },
		httpBodies: [],
		urlQueryParams: false,
		databaseQueryData: false,
		queues: false,
		stackFrameVariables: false,
		genAI: { inputs: false, outputs: false },
	},
});
