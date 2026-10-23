import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { toast } from "#/components/glaze/ui/toast";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { useDeviceTimezone } from "#/hooks/use-timezones";
import { authQueryKeys, sessionInfoQueryOptions } from "#/lib/auth.query";
import { setAccountTimezone } from "#/lib/timezone.functions";

export function AccountSettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const zoneLabelId = useId();
	const queryClient = useQueryClient();
	const device = useDeviceTimezone();
	const { data: timezone = null } = useQuery({
		...sessionInfoQueryOptions(),
		select: (session) => session.user?.timezone ?? null,
	});
	const save = useMutation({
		mutationFn: (next: string | null) =>
			setAccountTimezone({ data: { timezone: next } }),
		onSuccess: () => toast.success("Timezone saved"),
		onError: () =>
			toast.fail("Tripwire could not save the timezone. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Account settings</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<Field>
						<FieldLabel id={zoneLabelId}>Show times in</FieldLabel>
						<TimezonePicker
							disabled={save.isPending}
							labelledBy={zoneLabelId}
							onChange={(next) => save.mutate(next)}
							unsetLabel={`Org timezone, or this device (${device})`}
							value={timezone}
						/>
					</Field>
				</DialogBody>
				<DialogFooter>
					<DialogClose>Done</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
