import type { ReactNode } from "react";

const GROUND = "#FBFBFA";
const LINE = "#05050514";
const CROSS = "#05050540";
const INK = "#050505CC";
const INK_STRONG = "#050505E6";
const INK_MUTED = "#05050599";

export const TRIPWIRE_OG_METRICS = {
	height: 630,
	probeWidth: 4000,
	titleHeight: 58,
	titleWidth: 864,
	width: 1200,
} as const;

export interface TripwireOgFrameAssets {
	fireLeft: string;
	fireRight: string;
}

export function TripwireOgTitle({ text }: { text: string }) {
	return (
		<div
			style={{
				color: INK_STRONG,
				flexShrink: 0,
				fontFamily: "Geist",
				fontSize: 48,
				fontWeight: 500,
				letterSpacing: -1.68,
				lineHeight: "58px",
				whiteSpace: "nowrap",
			}}
		>
			{text}
		</div>
	);
}

function Cross({ left, top }: { left: number; top: number }) {
	return (
		<svg
			aria-hidden="true"
			height="21"
			style={{ left, position: "absolute", top }}
			viewBox="0 0 21 21"
			width="21"
		>
			<path d="M10.5 1v19M1 10.5h19" stroke={CROSS} />
		</svg>
	);
}

function Rule({
	height,
	left,
	top,
	width,
}: {
	height: number;
	left: number;
	top: number;
	width: number;
}) {
	return (
		<div
			style={{
				backgroundColor: LINE,
				height,
				left,
				position: "absolute",
				top,
				width,
			}}
		/>
	);
}

export function TripwireOgLockup() {
	return (
		<div
			style={{
				alignItems: "center",
				display: "flex",
				gap: 10,
				left: 148,
				position: "absolute",
				top: 19,
			}}
		>
			<svg
				aria-hidden="true"
				height="30"
				viewBox="0 178.093 71.005 71.005"
				width="30"
			>
				<path
					d="M32.185 215.044L32.628 215.044 32.406 215.429 30.755 218.299 31.125 218.514 33.615 219.957 34.445 218.514 35.266 217.086 35.488 216.702 35.709 217.086 36.53 218.514 37.36 219.957 39.85 218.514 40.22 218.3 38.569 215.429 38.348 215.044 38.79 215.044 40.537 215.044 42.093 215.044 42.093 211.73 40.537 211.73 38.79 211.73 38.348 211.73 38.569 211.345 40.22 208.474 39.993 208.343 37.36 206.817 36.482 208.343 35.709 209.688 35.488 210.072 35.266 209.688 34.492 208.343 33.615 206.817 30.982 208.343 30.755 208.474 32.406 211.345 32.627 211.73 32.185 211.73 30.403 211.73 28.882 211.73 28.882 215.044 30.403 215.044 32.185 215.044Z"
					fill={INK}
				/>
				<path
					d="M40.545 234.355L30.431 234.355L30.431 228.644L30.403 228.644L20.268 228.644L10.134 228.644L10.134 218.473L0 218.473L0 208.301L10.134 208.301L10.134 198.13L20.268 198.13L30.403 198.13L30.431 198.13L30.431 192.501L40.545 192.501L40.545 198.13L50.67 198.13L60.804 198.13L60.804 208.301L70.939 208.301L70.939 218.473L60.804 218.473L60.804 228.644L50.67 228.644L40.545 228.644L40.545 234.355ZM49.758 208.301C46.601 206.174 43.514 204.861 40.537 204.19C36.977 203.388 33.576 203.504 30.403 204.244C27.071 205.022 23.99 206.487 21.242 208.301L20.268 208.968C18.403 210.291 16.704 211.766 15.201 213.274C16.495 214.65 18.213 216.133 20.268 217.499C20.77 217.832 21.291 218.157 21.831 218.473C24.328 219.932 27.227 221.168 30.403 221.853C33.55 222.532 36.969 222.67 40.537 221.946C43.347 221.375 46.248 220.269 49.183 218.473C49.678 218.17 50.174 217.847 50.67 217.504C52.356 216.339 54.049 214.939 55.738 213.274C54.034 211.581 52.343 210.144 50.67 208.938C50.365 208.718 50.061 208.506 49.758 208.301Z"
					fill={INK}
				/>
			</svg>
			<div
				style={{
					color: INK,
					fontSize: 26,
					fontWeight: 500,
					letterSpacing: -0.26,
					lineHeight: "30px",
				}}
			>
				tripwire
			</div>
		</div>
	);
}

export function TripwireOgFrame({
	fireLeft,
	fireRight,
}: TripwireOgFrameAssets) {
	return (
		<>
			<img
				alt=""
				height={630}
				src={fireLeft}
				style={{ left: 0, position: "absolute", top: 0 }}
				width={120}
			/>
			<img
				alt=""
				height={630}
				src={fireRight}
				style={{ left: 1080, position: "absolute", top: 0 }}
				width={120}
			/>
			<Rule height={630} left={120} top={0} width={1} />
			<Rule height={630} left={1079} top={0} width={1} />
			<Rule height={1} left={0} top={68} width={1200} />
			<Rule height={1} left={0} top={530} width={1200} />
			<Cross left={110} top={58} />
			<Cross left={1069} top={58} />
			<Cross left={110} top={520} />
			<Cross left={1069} top={520} />
		</>
	);
}

export function TripwireOgAvatar({ src }: { src: string | null }) {
	const ring = { borderRadius: 999, boxShadow: `0 0 0 1px ${LINE}` };
	return src ? (
		<img alt="" height={40} src={src} style={ring} width={40} />
	) : (
		<div
			style={{
				...ring,
				backgroundColor: "#EDEDEC",
				height: 40,
				width: 40,
			}}
		/>
	);
}

export function TripwireOgCanvas({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				backgroundColor: GROUND,
				display: "flex",
				fontFamily: "Geist",
				height: TRIPWIRE_OG_METRICS.height,
				position: "relative",
				width: TRIPWIRE_OG_METRICS.width,
			}}
		>
			{children}
		</div>
	);
}

export function TripwireOgTitleBlock({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 18,
				left: 168,
				position: "absolute",
				top: 240,
				width: TRIPWIRE_OG_METRICS.titleWidth,
			}}
		>
			{children}
		</div>
	);
}

export function TripwireOgRepo({
	number,
	repo,
}: {
	number: number | null;
	repo: string;
}) {
	return (
		<div style={{ alignItems: "baseline", display: "flex", gap: 10 }}>
			<div style={{ color: INK_MUTED, fontSize: 26, lineHeight: "32px" }}>
				{repo}
			</div>
			{number === null ? null : (
				<div
					style={{
						color: INK,
						fontSize: 26,
						fontWeight: 500,
						lineHeight: "32px",
					}}
				>
					{`#${number}`}
				</div>
			)}
		</div>
	);
}

export function TripwireOgTitleWindow({
	children,
	fade,
}: {
	children: ReactNode;
	fade: boolean;
}) {
	return (
		<div
			style={{
				display: "flex",
				height: TRIPWIRE_OG_METRICS.titleHeight,
				overflow: "hidden",
				position: "relative",
				width: TRIPWIRE_OG_METRICS.titleWidth,
			}}
		>
			{children}
			{fade ? (
				<div
					style={{
						backgroundImage: `linear-gradient(90deg, ${GROUND}00 0%, ${GROUND} 100%)`,
						height: TRIPWIRE_OG_METRICS.titleHeight,
						position: "absolute",
						right: 0,
						top: 0,
						width: 160,
					}}
				/>
			) : null}
		</div>
	);
}

export function TripwireOgAuthor({
	avatar,
	name,
}: {
	avatar: string | null;
	name: string;
}) {
	return (
		<div
			style={{
				alignItems: "center",
				display: "flex",
				gap: 14,
				height: 40,
				left: 168,
				position: "absolute",
				top: 560,
			}}
		>
			<TripwireOgAvatar src={avatar} />
			<div
				style={{
					color: INK,
					fontSize: 24,
					fontWeight: 500,
					lineHeight: "30px",
				}}
			>
				{name}
			</div>
		</div>
	);
}
