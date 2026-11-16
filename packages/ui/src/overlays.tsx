import { type ConfirmOptions, confirm } from "@ui-sdk/core/alert-dialog";
import {
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	AlertDialog as BehaviorAlertDialog,
} from "@ui-sdk/react/alert-dialog";
import { OverlayHost as BehaviorOverlayHost } from "@ui-sdk/react/overlays";
import {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastTitle,
} from "@ui-sdk/react/toast";
import { OverlayPortal } from "./overlay-portal";

export function OverlayHost() {
	return (
		<div data-slot="overlay-host">
			<BehaviorOverlayHost
				toast={{
					side: "bottom",
					children: () => (
						<Toast data-slot="toast">
							<ToastTitle data-slot="toast-title" />
							<ToastDescription data-slot="toast-description" />
							<ToastAction data-slot="toast-action" />
							<ToastClose
								aria-label="Dismiss notification"
								data-slot="toast-close"
							>
								×
							</ToastClose>
						</Toast>
					),
				}}
			/>
			<BehaviorAlertDialog controller={confirm.controller}>
				<OverlayPortal>
					<AlertDialogBackdrop data-slot="alert-dialog-backdrop" />
					<AlertDialogContent
						data-slot="alert-dialog-content"
						initialFocus='[data-slot="dialog-cancel"] button'
					>
						{(state) => {
							const payload = state.payload as ConfirmOptions | undefined;
							return (
								<>
									<div data-slot="alert-dialog-panel">
										<AlertDialogTitle data-slot="dialog-title">
											{payload?.title ?? "Continue?"}
										</AlertDialogTitle>
										{payload?.description ? (
											<AlertDialogDescription data-slot="dialog-description">
												{payload.description}
											</AlertDialogDescription>
										) : null}
									</div>
									<footer data-slot="dialog-footer">
										<span data-slot="dialog-cancel">
											<AlertDialogClose>
												{payload?.cancelLabel ?? "Cancel"}
											</AlertDialogClose>
										</span>
										<span data-slot="alert-dialog-action">
											<AlertDialogClose
												className="glass glass-coral"
												data-agent-confirm={payload?.title}
												value="confirm"
											>
												{payload?.confirmLabel ?? "Continue"}
											</AlertDialogClose>
										</span>
									</footer>
								</>
							);
						}}
					</AlertDialogContent>
				</OverlayPortal>
			</BehaviorAlertDialog>
		</div>
	);
}
