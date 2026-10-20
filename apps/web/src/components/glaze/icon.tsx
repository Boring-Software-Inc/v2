import type {Icon as PhosphorIcon, IconProps as PhosphorProps} from '@phosphor-icons/react';
import {
  ArrowBendDownRightIcon, ArrowClockwiseIcon, ArrowDownIcon, ArrowElbowDownLeftIcon, ArrowLeftIcon, ArrowRightIcon,
  ArrowSquareOutIcon, ArrowUDownLeftIcon, ArrowUUpLeftIcon, ArrowUpIcon, ArrowUpRightIcon, ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon, BrainIcon, CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpIcon,
  CaretUpDownIcon, ChartLineIcon, CheckIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, CodeIcon, ColumnsIcon,
  CopyIcon, DotsThreeIcon, DownloadSimpleIcon, EyeIcon, EyeSlashIcon, FileIcon, FileArchiveIcon, FileAudioIcon,
  FileCodeIcon, FileCsvIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FunnelIcon, GearSixIcon, GlobeIcon, InfoIcon,
  KeyIcon, LinkSimpleIcon, LockIcon, MagnifyingGlassIcon, MicrophoneIcon, MicrophoneSlashIcon, MinusIcon, MoonIcon,
  PaperPlaneRightIcon, PaperclipIcon, PauseIcon, PencilSimpleIcon, PlayIcon, PlusIcon, RobotIcon, ShieldSlashIcon,
  SparkleIcon, SquareIcon, SunIcon, TableIcon, TerminalWindowIcon, TrashIcon, TrayIcon,
  UploadSimpleIcon, UserIcon, WarningIcon, WarningCircleIcon, WrenchIcon, XIcon, XCircleIcon, HourglassSimpleMediumIcon,
  BellIcon, BuildingsIcon, ChartBarIcon, ChatCircleIcon, ChatsCircleIcon, CommandIcon, CreditCardIcon, CursorIcon,
  DotsThreeVerticalIcon, EnvelopeIcon, FlowArrowIcon, FolderIcon, GitBranchIcon, GitForkIcon, GithubLogoIcon,
  GitlabLogoIcon, GitPullRequestIcon, HashIcon, HouseIcon, LightningIcon, ListChecksIcon, MonitorIcon, PackageIcon,
  PlugIcon, PulseIcon, QuestionIcon, QueueIcon, ShieldCheckIcon, SignOutIcon, SlidersHorizontalIcon, TreeStructureIcon,
  TrendDownIcon, TrendUpIcon, UserPlusIcon, UsersIcon,
} from '@phosphor-icons/react/ssr';
import {cn} from '#/lib/glaze/utils.ts';

// The one place Glaze imports icons from. Components import from here, never from @phosphor-icons/react, so the set
// can be swapped in one file.
//
// Phosphor, from its /ssr entry so an icon renders in a server component too (no context, no provider). Phosphor draws
// each weight as its own outline on a 256 grid, so the line scales with the size: regular is 1/16 of the box (0.875px
// at 14px, 1px at 16px), light 3/4 of that, bold 1.5 times. Regular in controls; light in dense rows and tables, where
// a dozen glyphs in a column would darken it; bold rarely, for a glyph that must hold at 12px on glass; fill only for
// the selected state of an icon toggle. Only the glyphs Glaze uses, under the names its components call them; to use
// another, import it above and name it here.
export const Add = PlusIcon;
export const ArrowDown = ArrowDownIcon;
export const ArrowLeft = ArrowLeftIcon;
export const ArrowRight = ArrowRightIcon;
export const ArrowUp = ArrowUpIcon;
export const ArrowUpRight = ArrowUpRightIcon;
export const Attachment = PaperclipIcon;
export const Bot = RobotIcon;
export const Calendar = CalendarBlankIcon;
export const Check = CheckIcon;
export const ChevronDown = CaretDownIcon;
export const ChevronLeft = CaretLeftIcon;
export const ChevronRight = CaretRightIcon;
export const ChevronSort = CaretUpDownIcon;
export const ChevronUp = CaretUpIcon;
export const ChartLine = ChartLineIcon;
export const Close = XIcon;
export const CollapseAll = ArrowsInLineVerticalIcon;
export const Code = CodeIcon;
export const Columns = ColumnsIcon;
export const Copy = CopyIcon;
export const Dark = MoonIcon;
export const Document = FileTextIcon;
export const DocumentBlank = FileIcon;
export const Download = DownloadSimpleIcon;
export const Edit = PencilSimpleIcon;
export const Empty = TrayIcon;
export const ExpandAll = ArrowsOutLineVerticalIcon;
export const Failed = WarningCircleIcon;
/** Status fail: a cross in a ring, so it differs from warn's triangle in shape, not only hue. */
export const FailedMark = XCircleIcon;
export const External = ArrowSquareOutIcon;
export const FileArchive = FileArchiveIcon;
export const FileAudio = FileAudioIcon;
export const FileCode = FileCodeIcon;
export const FileImage = FileImageIcon;
export const FileTable = FileCsvIcon;
export const FileVideo = FileVideoIcon;
export const Filter = FunnelIcon;
export const FollowUp = ArrowBendDownRightIcon;
export const Globe = GlobeIcon;
export const Hide = EyeSlashIcon;
export const Information = InfoIcon;
export const Key = KeyIcon;
export const Light = SunIcon;
export const Link = LinkSimpleIcon;
export const Locked = LockIcon;
export const NoAccess = ShieldSlashIcon;
export const NoResults = MagnifyingGlassIcon;
export const Microphone = MicrophoneIcon;
export const MicrophoneOff = MicrophoneSlashIcon;
export const Model = BrainIcon;
export const More = DotsThreeIcon;
export const Pause = PauseIcon;
export const Pending = CircleNotchIcon;
export const Play = PlayIcon;
export const Retry = ArrowClockwiseIcon;
export const Return = ArrowElbowDownLeftIcon;
export const Search = MagnifyingGlassIcon;
export const Send = PaperPlaneRightIcon;
export const Settings = GearSixIcon;
export const Show = EyeIcon;
export const Sparkle = SparkleIcon;
export const Stop = SquareIcon;
export const Subtract = MinusIcon;
export const Success = CheckCircleIcon;
export const TableView = TableIcon;
export const Terminal = TerminalWindowIcon;
export const Time = ClockIcon;
export const Tool = WrenchIcon;
export const TrashCan = TrashIcon;
export const Undo = ArrowUUpLeftIcon;
export const Upload = UploadSimpleIcon;
export const UserAvatar = UserIcon;
export const Warning = WarningIcon;
export const Waiting = HourglassSimpleMediumIcon;
export const Wrap = ArrowUDownLeftIcon;
export const Activity = PulseIcon;
export const Analytics = ChartBarIcon;
export const Billing = CreditCardIcon;
export const Branch = GitBranchIcon;
export const ChangeRequest = GitPullRequestIcon;
export const CommandKey = CommandIcon;
export const Comment = ChatCircleIcon;
export const Connection = PlugIcon;
export const Conversation = ChatsCircleIcon;
export const Customize = SlidersHorizontalIcon;
export const Folder = FolderIcon;
export const Fork = GitForkIcon;
export const GithubMark = GithubLogoIcon;
export const GitlabMark = GitlabLogoIcon;
export const Hash = HashIcon;
export const Help = QuestionIcon;
export const Home = HouseIcon;
export const Invite = UserPlusIcon;
export const Lightning = LightningIcon;
export const Mail = EnvelopeIcon;
export const Members = UsersIcon;
export const Moderation = QueueIcon;
export const Monitor = MonitorIcon;
export const MoreVertical = DotsThreeVerticalIcon;
export const Notification = BellIcon;
export const Organization = BuildingsIcon;
export const Package = PackageIcon;
export const Pointer = CursorIcon;
export const Protected = ShieldCheckIcon;
export const Rules = ListChecksIcon;
export const SignOut = SignOutIcon;
export const Tree = TreeStructureIcon;
export const TrendDown = TrendDownIcon;
export const TrendUp = TrendUpIcon;
export const Workflow = FlowArrowIcon;

export type GlazeIcon = PhosphorIcon;

/** Regular in controls (the default), light in dense rows and tables, bold rarely, fill only for a toggle that is on. */
export type IconWeight = 'light' | 'regular' | 'bold' | 'fill';

type IconProps = Omit<PhosphorProps, 'size' | 'weight' | 'color' | 'alt' | 'mirrored'> & {
  /** The icon, imported from this file. */
  icon: GlazeIcon;
  /** px. 12 in a small control or a tag, 14 in a control (the default), 16 in a large one, 20 and 24 on their own, 32 and 40 only for an empty state's glyph. */
  size?: 12 | 14 | 16 | 20 | 24 | 32 | 40;
  /** Regular by default. Light in dense rows and tables, bold rarely, fill only for the selected state of an icon toggle. */
  weight?: IconWeight;
  /** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
  label?: string;
};

export function Icon({icon: Glyph, size = 14, weight = 'regular', label, className, ...props}: IconProps) {
  return <Glyph
    size={size}
    weight={weight}
    focusable="false"
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    className={cn('shrink-0', className)}
    {...props}
  />;
}
