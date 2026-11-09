function normalized(filename: string) {
	return filename.replaceAll("\\", "/");
}

export function isApplicationSource(filename: string) {
	return normalized(filename).includes("/apps/web/src/");
}

export function isDesignSystemImplementation(filename: string) {
	const path = normalized(filename);
	return (
		path.includes("/apps/web/src/design-system/") ||
		path.includes("/apps/web/src/components/glaze/") ||
		path.includes("/apps/web/src/lib/glaze/")
	);
}

export function ownsLayoutGeometry(filename: string) {
	const path = normalized(filename);
	return (
		isDesignSystemImplementation(filename) ||
		path.includes("/apps/web/src/components/layouts/") ||
		path.endsWith("/apps/web/src/components/settings/settings-frame.tsx")
	);
}
