import { Check, Dark, Icon, Light, Monitor } from "@tripwire/ui/icon";
import { Label, SupportingText } from "@tripwire/ui/typography";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";
import { useHasMounted } from "#/hooks/use-has-mounted";
import "./theme-picker.css";

const THEMES = [
	{ value: "light", label: "Light", icon: Light },
	{ value: "dark", label: "Dark", icon: Dark },
	{ value: "system", label: "System", icon: Monitor },
] as const;

type Theme = (typeof THEMES)[number]["value"];

let activeReveal: ViewTransition | null = null;

export function ThemePicker({ reduceMotion }: { reduceMotion: boolean }) {
	const { theme, resolvedTheme, setTheme, systemTheme } = useTheme();
	const hasMounted = useHasMounted();

	function selectTheme(next: Theme, input: HTMLInputElement) {
		activeReveal?.skipTransition();

		const preview = input
			.closest("label")
			?.querySelector("[data-theme-preview]");
		const nextResolved = next === "system" ? systemTheme : next;
		if (
			reduceMotion ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
			!document.startViewTransition ||
			nextResolved === resolvedTheme ||
			!preview
		) {
			activeReveal = null;
			clearReveal();
			setTheme(next);
			return;
		}

		const root = document.documentElement;
		const rect = preview.getBoundingClientRect();
		const styles = getComputedStyle(preview);
		const insets = [
			rect.top,
			root.clientWidth - rect.right,
			root.clientHeight - rect.bottom,
			rect.left,
		]
			.map((inset) => `${inset}px`)
			.join(" ");
		root.style.setProperty(
			"--theme-reveal-clip",
			`inset(${insets} round ${styles.borderRadius})`,
		);
		root.style.setProperty(
			"--theme-reveal-duration",
			styles.getPropertyValue("--dur-step"),
		);
		root.style.setProperty(
			"--theme-reveal-ease",
			styles.getPropertyValue("--ease-move"),
		);
		root.dataset.themeReveal = "";

		const transition = document.startViewTransition(() => {
			if (activeReveal === transition) {
				flushSync(() => setTheme(next));
			}
		});
		activeReveal = transition;

		function finish() {
			if (activeReveal !== transition) return;
			activeReveal = null;
			clearReveal();
		}
		void transition.finished.then(finish, finish);
	}

	return (
		<>
			<div>
				<Label as="div" id="theme-label">
					Theme
				</Label>
				<SupportingText data-layout-role="theme-picker-hint">
					Choose how Tripwire looks on this device.
				</SupportingText>
			</div>
			<div
				aria-labelledby="theme-label"
				className="grid grid-cols-1 sm:grid-cols-3"
				data-layout-role="theme-picker-options"
				role="radiogroup"
			>
				{THEMES.map((item) => {
					const selected =
						(hasMounted ? (theme ?? "system") : "system") === item.value;
					return (
						<label className="group relative min-w-0" key={item.value}>
							<input
								checked={selected}
								className="peer sr-only"
								name="theme"
								onChange={(event) =>
									selectTheme(item.value, event.currentTarget)
								}
								type="radio"
								value={item.value}
							/>
							<span
								className="flex min-w-0 cursor-pointer flex-col rounded-overlay border text-start transition-colors duration-(--dur-state) ease-out peer-focus-visible:focus-ring"
								data-layout-role="theme-picker-option"
							>
								<ThemePreview value={item.value} />
								<Label data-layout-role="theme-picker-option-label">
									<Icon icon={item.icon} />
									<span>{item.label}</span>
									{selected ? (
										<span data-layout-role="theme-picker-selected">
											<Icon icon={Check} label="Selected" />
										</span>
									) : null}
								</Label>
							</span>
						</label>
					);
				})}
			</div>
		</>
	);
}

function clearReveal() {
	const root = document.documentElement;
	delete root.dataset.themeReveal;
	root.style.removeProperty("--theme-reveal-clip");
	root.style.removeProperty("--theme-reveal-duration");
	root.style.removeProperty("--theme-reveal-ease");
}

function ThemePreview({ value }: { value: Theme }) {
	if (value === "system") {
		return (
			<span data-layout-role="theme-preview-system" data-theme-preview="">
				<AppShellPreview compact tone="light" />
				<AppShellPreview compact tone="dark" />
			</span>
		);
	}
	return <AppShellPreview tone={value} />;
}

function AppShellPreview({
	tone,
	compact = false,
}: {
	tone: "light" | "dark";
	compact?: boolean;
}) {
	return (
		<span
			aria-hidden
			data-compact={compact || undefined}
			data-layout-role="theme-preview-shell"
			data-theme-preview={compact ? undefined : ""}
			data-tone={tone}
		>
			<span data-layout-role="theme-preview-sidebar">
				<span data-layout-role="theme-preview-logo" />
				<span data-layout-role="theme-preview-sidebar-line" data-line="first" />
				<span
					data-layout-role="theme-preview-sidebar-line"
					data-line="second"
				/>
				<span data-layout-role="theme-preview-sidebar-line" data-line="last" />
			</span>
			<span data-layout-role="theme-preview-content">
				<span
					data-layout-role="theme-preview-content-line"
					data-line="heading"
				/>
				<span
					data-layout-role="theme-preview-content-line"
					data-line="primary"
				/>
				<span
					data-layout-role="theme-preview-content-line"
					data-line="secondary"
				/>
				<span
					data-layout-role="theme-preview-content-line"
					data-line="footer"
				/>
			</span>
		</span>
	);
}
