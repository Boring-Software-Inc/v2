import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

test("navigation exposes the current location and follows native keyboard behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-navigation-"));
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const source = (file: string) =>
		JSON.stringify(join(root, "packages/ui/src", file));
	const entrypoint = join(directory, "client.tsx");

	try {
		await writeFile(
			entrypoint,
			`
			/* @jsxRuntime classic */
			import React, { useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from ${source("breadcrumb.tsx")};
			import { Pagination, PaginationEllipsis, PaginationInfo, PaginationLink, PaginationList, PaginationNext, PaginationPrevious } from ${source("pagination.tsx")};
			import { Step, StepIndicator, Steps, StepSeparator, StepTitle, StepTrigger } from ${source("steps.tsx")};

			function Navigation() {
				const pageNumber = Number(new URLSearchParams(location.search).get("page") ?? "2");
				const [step, setStep] = useState(2);
				const [source, setSource] = useState("");
				return (
					<main>
						<Breadcrumb label="Workspace path">
							<BreadcrumbList>
								<BreadcrumbItem><BreadcrumbLink href="#projects">Projects</BreadcrumbLink></BreadcrumbItem>
								<BreadcrumbSeparator />
								<BreadcrumbItem><BreadcrumbPage>Settings</BreadcrumbPage></BreadcrumbItem>
							</BreadcrumbList>
						</Breadcrumb>
						<Pagination label="Search results pages">
							<PaginationList>
								{pageNumber > 1 && <li><PaginationPrevious href="?page=1" /></li>}
								<li><PaginationLink href={String("?page=" + pageNumber)} current>Page {pageNumber}</PaginationLink></li>
								<li><PaginationEllipsis /></li>
								{pageNumber < 3 && <li><PaginationNext href="?page=3" /></li>}
							</PaginationList>
							<PaginationInfo from={51} to={73} total={73} noun="users" />
						</Pagination>
						<Steps aria-label="Account deletion progress" value={2}>
							<Step step={1}><StepTrigger><StepIndicator /><StepTitle>Review</StepTitle></StepTrigger></Step>
							<Step step={2}><StepTrigger><StepTitle>Confirm</StepTitle></StepTrigger></Step>
						</Steps>
						<Steps aria-label="Setup progress" value={step} onValueChange={(next, details) => {
							setStep(next);
							setSource(details.source);
						}}>
							<Step step={1}><StepTrigger><StepIndicator /><StepTitle>Repository</StepTitle></StepTrigger><StepSeparator /></Step>
							<Step step={2}><StepTrigger><StepTitle>Permissions</StepTitle></StepTrigger></Step>
							<Step step={3}><StepTrigger><StepTitle>Finish</StepTitle></StepTrigger></Step>
						</Steps>
						<output aria-label="Last interaction source">{source}</output>
					</main>
				);
			}

			createRoot(document.getElementById("root")).render(<Navigation />);
			`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		expect(build.success).toBe(true);
		const [artifact] = build.outputs;
		if (!artifact) throw new Error("Navigation fixture did not build");
		const script = await artifact.text();
		const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
		const browser = await chromium.launch({ executablePath });

		try {
			const page = await browser.newPage();
			page.setDefaultTimeout(2_000);
			await page.route("http://navigation.test/**", (route) =>
				route.request().url().endsWith("/client.js")
					? route.fulfill({ body: script, contentType: "text/javascript" })
					: route.fulfill({
							body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/client.js"></script>',
							contentType: "text/html",
						}),
			);
			await page.goto("http://navigation.test/");
			const breadcrumb = page.getByRole("navigation", {
				name: "Workspace path",
			});
			const ancestor = breadcrumb.getByRole("link", { name: "Projects" });
			await ancestor.waitFor();
			expect(await breadcrumb.getByRole("listitem").count()).toBe(2);
			expect(
				await breadcrumb.getByText("Settings").getAttribute("aria-current"),
			).toBe("page");
			expect(await breadcrumb.getByRole("link").count()).toBe(1);

			const pagination = page.getByRole("navigation", {
				name: "Search results pages",
			});
			const previous = pagination.getByRole("link", { name: "Previous" });
			const current = pagination.getByRole("link", { name: "Page 2" });
			const next = pagination.getByRole("link", { name: "Next" });
			const focused = () =>
				page.evaluate(() => document.activeElement?.textContent?.trim());
			expect(await current.getAttribute("aria-current")).toBe("page");
			expect(
				await pagination.locator('[data-slot="pagination-info"]').textContent(),
			).toBe("51–73 of 73 users");

			await page.keyboard.press("Tab");
			expect(await focused()).toBe("Projects");
			await page.keyboard.press("Enter");
			await page.waitForURL("**/#projects");
			await page.keyboard.press("Tab");
			expect(await focused()).toBe("Previous");

			await page.keyboard.press("Tab");
			expect(await focused()).toBe("Page 2");
			await page.keyboard.press("Tab");
			expect(await focused()).toBe("Next");

			const display = page.getByRole("list", {
				name: "Account deletion progress",
			});
			expect(await display.getByRole("button").count()).toBe(0);
			expect(
				await display.getByRole("listitem").nth(1).getAttribute("aria-current"),
			).toBe("step");
			const interactive = page.getByRole("list", { name: "Setup progress" });
			const finish = interactive.getByRole("button", { name: "Finish" });
			expect(await finish.isDisabled()).toBe(true);
			await page.keyboard.press("Tab");
			expect(await focused()).toContain("Repository");
			await page.keyboard.press("Tab");
			expect(await focused()).toBe("Permissions");
			await page.keyboard.press("Tab");
			expect(await focused()).not.toBe("Finish");

			const repository = interactive.getByRole("button", {
				name: "Repository",
			});
			await repository.press("Space");
			const selected = interactive.locator('[aria-current="step"]');
			await selected.getByText("Repository").waitFor();
			expect(await selected.count()).toBe(1);
			expect(
				await interactive
					.getByRole("button", { name: "Permissions" })
					.isDisabled(),
			).toBe(true);
			expect(
				await page.getByLabel("Last interaction source").textContent(),
			).toBe("keyboard");
			expect(
				await repository.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);

			await next.press("Enter");
			await page.waitForURL("**/?page=3");
			const lastPage = pagination.getByRole("link", { name: "Page 3" });
			expect(await lastPage.getAttribute("aria-current")).toBe("page");
			expect(await next.count()).toBe(0);

			await previous.press("Enter");
			await page.waitForURL("**/?page=1");
			const firstPage = pagination.getByRole("link", { name: "Page 1" });
			expect(await firstPage.getAttribute("aria-current")).toBe("page");
			expect(await previous.count()).toBe(0);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
