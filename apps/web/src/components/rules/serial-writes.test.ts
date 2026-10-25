import { describe, expect, test } from "bun:test";
import { createSerialWrites } from "./serial-writes";

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("serial outcome writes", () => {
	test("a second write for a rule waits for the first, so the newest lands last", async () => {
		const serial = createSerialWrites();
		const landed: string[] = [];
		const slow = deferred();
		let idle = 0;
		const onIdle = async () => {
			idle++;
		};
		const first = serial(
			"age",
			async () => {
				await slow.promise;
				landed.push("outcome");
			},
			onIdle,
		);
		const second = serial(
			"age",
			async () => {
				landed.push("instruction");
			},
			onIdle,
		);
		await Promise.resolve();
		expect(landed).toEqual([]);
		slow.resolve();
		await Promise.all([first, second]);
		await serial("age", async () => undefined, onIdle);
		expect(landed).toEqual(["outcome", "instruction"]);
		expect(idle).toBe(1);
	});

	test("the refetch waits until the rule has no queued write", async () => {
		const serial = createSerialWrites();
		const events: string[] = [];
		const onIdle = async () => {
			events.push("refetch");
		};
		const gate = deferred();
		const first = serial(
			"age",
			async () => {
				events.push("first");
			},
			onIdle,
		);
		const second = serial(
			"age",
			async () => {
				await gate.promise;
				events.push("second");
			},
			onIdle,
		);
		await first;
		expect(events).toEqual(["first"]);
		gate.resolve();
		await second;
		await serial(
			"other",
			async () => undefined,
			async () => undefined,
		);
		await new Promise((done) => setTimeout(done, 0));
		expect(events).toEqual(["first", "second", "refetch"]);
	});

	test("a failed write does not stop the next one", async () => {
		const serial = createSerialWrites();
		const failed = serial(
			"age",
			() => Promise.reject(new Error("down")),
			async () => undefined,
		);
		await expect(failed).rejects.toThrow("down");
		expect(
			await serial(
				"age",
				async () => "saved",
				async () => undefined,
			),
		).toBe("saved");
	});

	test("different rules write independently", async () => {
		const serial = createSerialWrites();
		const gate = deferred();
		const blocked = serial(
			"age",
			() => gate.promise,
			async () => undefined,
		);
		expect(
			await serial(
				"crypto",
				async () => "done",
				async () => undefined,
			),
		).toBe("done");
		gate.resolve();
		await blocked;
	});
});
