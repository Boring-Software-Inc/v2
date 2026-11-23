/**
 * @tripwire/utils — shared helpers so agents never redefine them.
 * Check here before writing any inline helper; a helper used by 2+ files
 * moves here.
 */

export { pendingCheckIsStale, supersededBy } from "./action-supersession.ts";
export { cryptoAddressCandidates, isCryptoAddress } from "./crypto-address.ts";
export {
	createDatabuddyApi,
	DATABUDDY_API_URL,
	type DatabuddyApi,
	type DatabuddyApiConfig,
	DatabuddyApiError,
	type DatabuddyProfileActivity,
} from "./databuddy-api.ts";
export {
	getDatabuddyUserOverride,
	updateDatabuddyUserOverrides,
} from "./databuddy-overrides.ts";
export { getErrorMessage, toError } from "./errors.ts";
export {
	type GuardedFetchDeps,
	type GuardedFetchResult,
	type GuardedPostOptions,
	type GuardFailure,
	guardedPost,
	guardedPostMultipart,
	isBlockedAddress,
	isDeliverableUrl,
	MAX_URL_LENGTH,
	type MultipartFile,
} from "./guarded-fetch.ts";
export { generateId } from "./id.ts";
export {
	generateWorkflowName,
	pickWorkflowName,
} from "./names.ts";
export { backoffWithJitter, isRetryableForgeStatus } from "./retry.ts";
export { skipWhenDraft } from "./skip-when-draft.ts";
export {
	type DitherChartOptions,
	encodePng,
	renderDitherChart,
	renderSparklinePng,
	type SparklineOptions,
	type SparkSeries,
} from "./sparkline-png.ts";
export { truncate } from "./string.ts";
export { sleep, withTimeout } from "./time.ts";
export {
	validateWalletAddress,
	WALLET_ADDRESS_CHAINS,
} from "./wallet-address.ts";
export {
	createWalletAddressInspector,
	type WalletAddressInspectorOptions,
	type WalletAddressReader,
} from "./wallet-address-inspector.ts";
