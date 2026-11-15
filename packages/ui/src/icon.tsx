import type {
	Icon as PhosphorIcon,
	IconProps as PhosphorIconProps,
} from "@phosphor-icons/react";
import {
	DotsThreeIcon,
	DotsThreeVerticalIcon,
} from "@phosphor-icons/react/ssr";

export {
	ArchiveIcon as Archive,
	ArrowBendDownRightIcon as Except,
	ArrowBendDownRightIcon as FollowUp,
	ArrowClockwiseIcon as Retry,
	ArrowDownIcon as ArrowDown,
	ArrowElbowDownLeftIcon as Return,
	ArrowLeftIcon as ArrowLeft,
	ArrowRightIcon as ArrowRight,
	ArrowSquareOutIcon as External,
	ArrowsInLineVerticalIcon as CollapseAll,
	ArrowsMergeIcon as Converge,
	ArrowsOutLineVerticalIcon as ExpandAll,
	ArrowUDownLeftIcon as Wrap,
	ArrowUpIcon as ArrowUp,
	ArrowUpRightIcon as ArrowUpRight,
	ArrowUUpLeftIcon as Undo,
	AtIcon as Mention,
	BellIcon as Notification,
	BookBookmarkIcon as Repo,
	BooksIcon as Repos,
	BracketsCurlyIcon as Braces,
	BrainIcon as Model,
	BriefcaseIcon as Briefcase,
	BuildingsIcon as Organization,
	CalendarBlankIcon as Calendar,
	CaretDownIcon as ChevronDown,
	CaretLeftIcon as ChevronLeft,
	CaretRightIcon as ChevronRight,
	CaretUpDownIcon as ChevronSort,
	CaretUpIcon as ChevronUp,
	ChartBarIcon as Analytics,
	ChartLineIcon as ChartLine,
	ChartPieSliceIcon as PieSlice,
	ChatCircleIcon as Comment,
	ChatsCircleIcon as Conversation,
	ChatTextIcon as CommentText,
	CheckCircleIcon as Success,
	CheckIcon as Check,
	CheckSquareOffsetIcon as FormatCheck,
	ChecksIcon as Checks,
	CircleHalfIcon as HalfCircle,
	CircleNotchIcon as Pending,
	ClockIcon as Time,
	CodeBlockIcon as CodeBlock,
	CodeIcon as Code,
	ColumnsIcon as Columns,
	CommandIcon as CommandKey,
	CopyIcon as Copy,
	CornersOutIcon as FitView,
	CreditCardIcon as Billing,
	CursorIcon as Pointer,
	DiscordLogoIcon as DiscordMark,
	DotsSixVerticalIcon as DragHandle,
	DownloadSimpleIcon as Download,
	EnvelopeIcon as Mail,
	EyeIcon as Show,
	EyeSlashIcon as Hide,
	FileArchiveIcon as FileArchive,
	FileAudioIcon as FileAudio,
	FileCodeIcon as FileCode,
	FileCsvIcon as FileTable,
	FileDashedIcon as Draft,
	FileIcon as DocumentBlank,
	FileImageIcon as FileImage,
	FilesIcon as Files,
	FileTextIcon as Document,
	FileVideoIcon as FileVideo,
	FlagIcon as Flag,
	FlowArrowIcon as Workflow,
	FolderIcon as Folder,
	FunnelIcon as Filter,
	GaugeIcon as Gauge,
	GearSixIcon as Settings,
	GitBranchIcon as Branch,
	GitCommitIcon as Commit,
	GitDiffIcon as Diff,
	GitForkIcon as Fork,
	GithubLogoIcon as GithubMark,
	GitlabLogoIcon as GitlabMark,
	GitMergeIcon as Merge,
	GitPullRequestIcon as ChangeRequest,
	GlobeHemisphereWestIcon as Elsewhere,
	GlobeIcon as Globe,
	HashIcon as Hash,
	HourglassSimpleMediumIcon as Waiting,
	HouseIcon as Home,
	IdentificationBadgeIcon as MemberBadge,
	InfoIcon as Information,
	KeyIcon as Key,
	LightningIcon as Lightning,
	LinkSimpleIcon as Link,
	ListBulletsIcon as ListBullets,
	ListChecksIcon as Rules,
	LockIcon as Locked,
	MagnifyingGlassIcon as NoResults,
	MagnifyingGlassIcon as Search,
	MapPinIcon as MapPin,
	MicrophoneIcon as Microphone,
	MicrophoneSlashIcon as MicrophoneOff,
	MinusCircleIcon as Negate,
	MinusIcon as Subtract,
	MinusSquareIcon as LinesDeleted,
	MonitorIcon as Monitor,
	MoonIcon as Dark,
	PackageIcon as Package,
	PaperclipIcon as Attachment,
	PaperPlaneRightIcon as Send,
	PauseIcon as Pause,
	PencilSimpleIcon as Edit,
	PercentIcon as Percent,
	PlayIcon as Play,
	PlugIcon as Connection,
	PlusIcon as Add,
	PlusMinusIcon as LinesChanged,
	PlusSquareIcon as LinesAdded,
	ProhibitIcon as Blocked,
	PulseIcon as Activity,
	QuestionIcon as Help,
	QueueIcon as Moderation,
	QuotesIcon as Quote,
	RecordIcon as Issue,
	RobotIcon as Bot,
	RulerIcon as Ruler,
	SealCheckIcon as Verified,
	ShieldCheckIcon as Protected,
	ShieldSlashIcon as NoAccess,
	SignOutIcon as SignOut,
	SlidersHorizontalIcon as Customize,
	SmileyIcon as Emoji,
	SparkleIcon as Sparkle,
	SquareIcon as Stop,
	StackIcon as Stack,
	SunIcon as Light,
	TableIcon as TableView,
	TagIcon as Tag,
	TargetIcon as Target,
	TerminalIcon as Prompt,
	TerminalWindowIcon as Terminal,
	TextAlignLeftIcon as Paragraph,
	TextTIcon as Heading,
	ThumbsDownIcon as ThumbsDown,
	TranslateIcon as Translate,
	TrashIcon as TrashCan,
	TrayIcon as Empty,
	TrayIcon as Inbox,
	TreeStructureIcon as Tree,
	TrendDownIcon as TrendDown,
	TrendUpIcon as TrendUp,
	UploadSimpleIcon as Upload,
	UserCheckIcon as UserCheck,
	UserFocusIcon as UserFocus,
	UserIcon as UserAvatar,
	UserListIcon as UserList,
	UserPlusIcon as Invite,
	UsersIcon as Members,
	WalletIcon as Wallet,
	WarningCircleIcon as Failed,
	WarningIcon as Warning,
	WebhooksLogoIcon as Webhook,
	WrenchIcon as Tool,
	XCircleIcon as FailedMark,
	XIcon as Close,
} from "@phosphor-icons/react/ssr";

export const More = DotsThreeIcon;
export const MoreVertical = DotsThreeVerticalIcon;

export type IconGlyph = PhosphorIcon;
export type IconWeight = "light" | "regular" | "bold" | "fill";
export type IconTone =
	| "primary"
	| "secondary"
	| "tertiary"
	| "disabled"
	| "success"
	| "warning"
	| "danger";

export interface IconProps {
	/** The semantic glyph rendered by this icon. */
	icon: IconGlyph;
	/** The finite icon sizes used by Tripwire controls and empty states. */
	size?: 12 | 14 | 16 | 18 | 20 | 24 | 32 | 40;
	/** The visual weight used to distinguish control and status glyphs. */
	weight?: IconWeight;
	/** Accessible name. Without one, the icon is decorative. */
	label?: string;
	/** Semantic color role inherited from the Tripwire color contract. */
	tone?: IconTone;
	/** Standard motion used for indeterminate or pending glyphs. */
	motion?: "spin";
}

const BOLD_BY_DEFAULT = new Set<IconGlyph>([
	DotsThreeIcon,
	DotsThreeVerticalIcon,
]);

export function Icon({
	icon: Glyph,
	size = 14,
	weight,
	label,
	tone,
	motion,
}: IconProps) {
	const isMoreGlyph = BOLD_BY_DEFAULT.has(Glyph);
	const accessibleLabel = label?.trim();
	const accessibilityProps: Pick<
		PhosphorIconProps,
		"aria-hidden" | "aria-label" | "role"
	> = accessibleLabel
		? { "aria-label": accessibleLabel, role: "img" }
		: { "aria-hidden": true };

	return (
		<Glyph
			{...accessibilityProps}
			data-glyph={isMoreGlyph ? "more" : undefined}
			data-motion={motion}
			data-slot="icon"
			data-tone={tone}
			focusable="false"
			size={size}
			weight={weight ?? (isMoreGlyph ? "bold" : "regular")}
		/>
	);
}
