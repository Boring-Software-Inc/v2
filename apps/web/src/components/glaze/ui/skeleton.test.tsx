import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton, SkeletonSwap } from "#/components/glaze/ui/skeleton";

describe("Skullet-backed Glaze skeletons", () => {
	test("keeps Glaze dimensions on the box that owns layout", () => {
		const markup = renderToStaticMarkup(
			<Skeleton className="h-4 w-8 rounded-pill" />,
		);
		expect(markup).toContain('data-slot="skeleton"');
		expect(markup).toContain("h-4 w-8 rounded-pill");
		expect(markup).toContain('style="height:100%;width:100%;border-radius:inherit"');
		expect(markup).not.toContain('style="height:1em;width:60%');
	});

	test("uses the supplied silhouette and accessible label on a first load", () => {
		const markup = renderToStaticMarkup(
			<SkeletonSwap
				fallback={<div>Run silhouette</div>}
				label="Loading run"
				loading
			>
				<div>Loaded run</div>
			</SkeletonSwap>,
		);
		expect(markup).toContain("Run silhouette");
		expect(markup).toContain('aria-busy="true"');
		expect(markup).not.toContain("Loaded run");
	});

	test("renders content without a loading shell once data is ready", () => {
		const markup = renderToStaticMarkup(
			<SkeletonSwap fallback={<div>Run silhouette</div>} loading={false}>
				<div>Loaded run</div>
			</SkeletonSwap>,
		);
		expect(markup).toContain("Loaded run");
		expect(markup).not.toContain("Run silhouette");
	});
});
