/**
 * The batched save queue. Adoption: wrap in SaveQueueProvider (savedValues +
 * commit, isEqual for object-valued keys), bind controls via useSaveQueueField,
 * and MOUNT UnsavedChangesBar — the bar arms the navigation guard. A page that
 * mounts the provider without the bar has NO nav protection while dirty.
 */
export {
	type SaveQueueCommit,
	type SaveQueueCommitResult,
	SaveQueueNavGuard,
	SaveQueueProvider,
	type SaveQueueProviderProps,
	useSaveQueue,
	useSaveQueueField,
} from "./save-queue-context";
export { UnsavedChangesBar } from "./unsaved-changes-bar";
