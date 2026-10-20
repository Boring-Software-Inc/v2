import { Badge } from "#/components/glaze/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import {
	DataList,
	DataListItem,
	DataListLabel,
	DataListValue,
} from "#/components/glaze/ui/data-list";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/glaze/ui/table";
import type { MascotSnapshot } from "#/components/mascot/engine";
import {
	MASCOT_EVENTS,
	MASCOT_STATES,
	TRANSITIONS,
} from "#/components/mascot/machine";

export type MascotMachineCardProps = {
	snapshot: MascotSnapshot;
	debug: boolean;
};

export function MascotMachineCard({ snapshot, debug }: MascotMachineCardProps) {
	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>State machine</CardTitle>
				</CardHeader>
				<CardContent>
					<DataList aria-live="polite">
						<DataListItem>
							<DataListLabel>State</DataListLabel>
							<DataListValue data-testid="mascot-state" mono>
								{snapshot.state}
							</DataListValue>
						</DataListItem>
						<DataListItem>
							<DataListLabel>Face</DataListLabel>
							<DataListValue mono>{snapshot.expression}</DataListValue>
						</DataListItem>
						<DataListItem>
							<DataListLabel>Last event</DataListLabel>
							<DataListValue>
								{snapshot.lastEvent ? (
									<span className="inline-flex items-center gap-2">
										<span className="mono" data-testid="mascot-last-event">
											{snapshot.lastEvent}
										</span>
										<Badge variant={snapshot.lastAccepted ? "ok" : "warn"}>
											{snapshot.lastAccepted ? "Accepted" : "Ignored"}
										</Badge>
									</span>
								) : (
									"None yet"
								)}
							</DataListValue>
						</DataListItem>
						<DataListItem>
							<DataListLabel>Allowed next</DataListLabel>
							<DataListValue>
								<span className="flex flex-wrap gap-1">
									{snapshot.allowed.map((event) => (
										<Badge key={event} variant="outline">
											<span className="mono">{event}</span>
										</Badge>
									))}
								</span>
							</DataListValue>
						</DataListItem>
					</DataList>
				</CardContent>
			</Card>

			{debug ? (
				<Table aria-label="Transition table" title="Transition table">
					<TableHeader>
						<TableRow>
							<TableHead>State</TableHead>
							<TableHead>Event to next state</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{MASCOT_STATES.map((state) => (
							<TableRow key={state} selected={state === snapshot.state}>
								<TableCell mono>{state}</TableCell>
								<TableCell>
									<span className="flex flex-wrap gap-1">
										{MASCOT_EVENTS.filter(
											(event) => TRANSITIONS[state][event],
										).map((event) => (
											<Badge key={event}>
												<span className="mono">
													{event} to {TRANSITIONS[state][event]}
												</span>
											</Badge>
										))}
									</span>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : null}
		</>
	);
}
