import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "#/components/glaze/ui/toast";
import { adminQueryKeys } from "#/lib/admin.query";
import type { StaffActionResult } from "#/lib/staff-users.functions";
import { staffUserQueryKeys } from "#/lib/staff-users.query";

export class StaffActionError extends Error {}

export async function unwrapStaffAction(
	result: Promise<StaffActionResult>,
): Promise<void> {
	const value = await result;
	if (!value.ok) {
		throw new StaffActionError(value.error);
	}
}

export function errorText(error: Error, fallback: string): string {
	return error.message || fallback;
}

export function useStaffAction<TInput>(input: {
	userId: string;
	run: (value: TInput) => Promise<StaffActionResult>;
	failure: string;
	success?: (value: TInput) => string | null;
	scope?: "detail" | "flags" | "list";
	toastErrors?: boolean;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (value: TInput) => unwrapStaffAction(input.run(value)),
		onSuccess: (_result, value) => {
			const message = input.success?.(value);
			if (message) {
				toast.success(message);
			}
		},
		onError: (error) => {
			if (input.toastErrors !== false) {
				toast.fail(errorText(error, input.failure));
			}
		},
		onSettled: () => {
			const scope = input.scope ?? "detail";
			if (scope === "flags") {
				return queryClient.invalidateQueries({
					queryKey: staffUserQueryKeys.flags(input.userId),
				});
			}
			if (scope === "list") {
				return queryClient.invalidateQueries({ queryKey: adminQueryKeys.all });
			}
			return Promise.all([
				queryClient.invalidateQueries({
					queryKey: staffUserQueryKeys.detail(input.userId),
				}),
				queryClient.invalidateQueries({
					queryKey: adminQueryKeys.usersAll(),
				}),
			]);
		},
	});
}
