import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Avatar, AvatarFallback, AvatarGroup, initialsOf } from "./avatar";
import { Badge } from "./badge";
import { ButtonGroupMenu } from "./button-group";
import { Card, CardContent, CardFooter, CardTitle } from "./card";
import {
	DataList,
	DataListItem,
	DataListLabel,
	DataListValue,
} from "./data-list";
import { EmptyState, EmptyStateTitle } from "./empty-state";
import { Check, Icon, Pending } from "./icon";
import { Item, ItemGroup, ItemLink, ItemMedia } from "./item";
import { PaginationInfo } from "./pagination";
import { SkeletonSwap, SkeletonText } from "./skeleton";
import { Status } from "./status";
import { Step, StepIndicator, Steps, StepTrigger } from "./steps";
import { Table, TableBody, TableCell, TableHead, TableRow } from "./table";

describe("presentational primitives", () => {
	test("keeps decorative and named icons semantically distinct", () => {
		const markup = renderToStaticMarkup(
			<>
				<Icon icon={Check} tone="success" />
				<Icon icon={Pending} label="Loading" motion="spin" size={20} />
			</>,
		);
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain('data-tone="success"');
		expect(markup).toContain('aria-label="Loading"');
		expect(markup).toContain('data-motion="spin"');
		expect(markup).toContain('role="img"');
	});

	test("exposes semantic state through finite data attributes", () => {
		const markup = renderToStaticMarkup(
			<>
				<Alert status="warning">
					<AlertTitle>Review needed</AlertTitle>
				</Alert>
				<Badge tone="danger">Blocked</Badge>
				<Status status="ok" />
			</>,
		);
		expect(markup).toContain('data-status="warning"');
		expect(markup).toContain(
			'<div data-slot="alert-title">Review needed</div>',
		);
		expect(markup).not.toContain("<h3");
		expect(markup).toContain('data-tone="danger"');
		expect(markup).toContain("Passed");
	});

	test("keeps card footer outside the card panel", () => {
		const markup = renderToStaticMarkup(
			<Card>
				<CardTitle>Run</CardTitle>
				<CardContent>Details</CardContent>
				<CardFooter>Updated now</CardFooter>
			</Card>,
		);
		expect(markup.indexOf('data-slot="card-panel"')).toBeLessThan(
			markup.indexOf('data-slot="card-footer"'),
		);
		expect(markup).toContain('data-footer="true"');
	});

	test("adds a decorative status icon only to notices", () => {
		const markup = renderToStaticMarkup(
			<Alert status="success" variant="notice">
				<AlertTitle>Accepted</AlertTitle>
				<AlertDescription>Updated</AlertDescription>
			</Alert>,
		);
		expect(markup).toContain('data-variant="notice"');
		expect(markup).toMatch(
			/data-slot="alert-icon"><svg[^>]*aria-hidden="true"/,
		);
		expect(markup).toContain('data-slot="alert-description">Updated');
		expect(renderToStaticMarkup(<Alert />)).not.toContain(
			'data-slot="alert-icon"',
		);
	});

	test("renders empty data-list values explicitly", () => {
		const markup = renderToStaticMarkup(
			<DataList>
				<DataListItem>
					<DataListLabel>Owner</DataListLabel>
					<DataListValue>{null}</DataListValue>
				</DataListItem>
			</DataList>,
		);
		expect(markup).toContain("None");
		expect(markup).toContain('data-empty="true"');
	});

	test("provides deterministic avatar initials", () => {
		expect(initialsOf("Grim Labs")).toBe("GL");
		expect(initialsOf("grim@example.com", "xs")).toBe("G");
		const markup = renderToStaticMarkup(
			<AvatarGroup max={3} size="sm">
				<Avatar decorative name="Grim Labs" src="/grim.png" />
				<Avatar name="Trip Wire" type="agent">
					<AvatarFallback />
				</Avatar>
				<Avatar name="Source" type="source" />
				<Avatar name="Another source" type="source" />
			</AvatarGroup>,
		);
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain('data-type="agent"');
		expect(markup).toContain('data-slot="avatar-group-count"');
	});

	test("counts the overflow indicator toward a single-slot avatar group", () => {
		const markup = renderToStaticMarkup(
			<AvatarGroup max={1} label="Reviewers">
				<Avatar name="Sam Okafor" />
				<Avatar name="Rin Takeda" />
			</AvatarGroup>,
		);
		expect(markup).not.toContain('data-slot="avatar-group-item"');
		expect(markup).toContain("and 2 more");
		expect(markup).toContain("Sam Okafor, Rin Takeda");
	});

	test("exposes finite presentation variants", () => {
		const markup = renderToStaticMarkup(
			<>
				<Badge tone="warning" variant="outline">
					Pending
				</Badge>
				<EmptyState reason="error" size="sm" variant="plain">
					<EmptyStateTitle>Could not load</EmptyStateTitle>
				</EmptyState>
			</>,
		);
		expect(markup).toContain('data-variant="outline"');
		expect(markup).toContain('role="alert"');
		expect(markup).toContain('data-reason="error"');
	});

	test("marks item selection, media, and disabled links semantically", () => {
		const markup = renderToStaticMarkup(
			<ItemGroup variant="panel">
				<Item density="compact" selected>
					<ItemMedia variant="image" />
					<ItemLink disabled href="/hidden">
						Hidden
					</ItemLink>
				</Item>
			</ItemGroup>,
		);
		expect(markup).toContain('role="list"');
		expect(markup).toContain('data-selected="true"');
		expect(markup).toContain('aria-disabled="true"');
		expect(markup).not.toContain('href="/hidden"');
	});

	test("keeps settled content visible during background skeleton refreshes", () => {
		const markup = renderToStaticMarkup(
			<SkeletonSwap
				fallback={<SkeletonText lines={2} type="label" />}
				loading={false}
			>
				Settled content
			</SkeletonSwap>,
		);
		expect(markup).toContain("Settled content");
		expect(markup).not.toContain('data-slot="skeleton-fallback"');
	});

	test("renders pagination ranges and controlled steps", () => {
		const markup = renderToStaticMarkup(
			<>
				<PaginationInfo from={1} noun="runs" to={50} total={1204} />
				<Steps onValueChange={() => undefined} value={2}>
					<Step step={1}>
						<StepTrigger>
							<StepIndicator />
							Connect
						</StepTrigger>
					</Step>
				</Steps>
			</>,
		);
		expect(markup).toContain("1–50");
		expect(markup).toContain("1,204 runs");
		expect(markup).toContain('data-state="done"');
	});

	test("names only the scroll region when an accessible name is supplied", () => {
		const markup = renderToStaticMarkup(
			<Table aria-label="Members" scrollLabel="Members table" />,
		);
		expect(markup).toContain(
			'data-slot="table-container" aria-label="Members table" role="region" tabindex="0"',
		);
		expect(markup).toContain('aria-label="Members"');
	});

	test("uses native table semantics", () => {
		const markup = renderToStaticMarkup(
			<Table>
				<thead>
					<TableRow>
						<TableHead numeric sort="asc">
							Count
						</TableHead>
					</TableRow>
				</thead>
				<TableBody>
					<TableRow selected>
						<TableCell numeric>Value</TableCell>
					</TableRow>
				</TableBody>
			</Table>,
		);
		expect(markup).toContain("<table");
		expect(markup).toContain("<tbody");
		expect(markup).toContain("<td");
		expect(markup).toContain('aria-sort="ascending"');
		expect(markup).toContain('aria-selected="true"');
	});

	test("puts the toolbar and scroll region inside only card frames", () => {
		const card = renderToStaticMarkup(
			<Table footer="Pagination" toolbar="Filters" />,
		);
		const bare = renderToStaticMarkup(<Table frame="none" toolbar="Filters" />);
		expect(card).toContain(
			'data-slot="table-panel"><div data-slot="table-toolbar"',
		);
		expect(card).toContain(
			'</table></div></div><div data-slot="table-footer-row"',
		);
		expect(bare).not.toContain('data-slot="table-panel"');
		expect(bare).toContain('data-slot="table-toolbar">Filters');
	});

	test("backs split-button alternatives with the package menu", () => {
		const markup = renderToStaticMarkup(
			<ButtonGroupMenu
				items={[
					{
						label: "Create from template",
						onAction: () => undefined,
						value: "template",
					},
				]}
				label="More creation options"
			/>,
		);
		expect(markup).toContain('data-slot="button"');
		expect(markup).toContain('aria-label="More creation options"');
	});
});
