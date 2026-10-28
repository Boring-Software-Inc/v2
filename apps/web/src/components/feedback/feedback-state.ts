export type FeedbackPhase = "closed" | "picking" | "open";

export interface FeedbackState<P> {
	phase: FeedbackPhase;
	picked: P | null;
	draft: string;
	resumable: boolean;
	session: number;
}

export type FeedbackAction<P> =
	| { type: "start" }
	| { type: "pick"; picked: P | null }
	| { type: "pick-again" }
	| { type: "cancel-picking" }
	| { type: "draft"; value: string }
	| { type: "close" }
	| { type: "finish"; session: number };

export function initialFeedbackState<P>(): FeedbackState<P> {
	return {
		phase: "closed",
		picked: null,
		draft: "",
		resumable: false,
		session: 0,
	};
}

function closed<P>(state: FeedbackState<P>): FeedbackState<P> {
	return {
		...state,
		phase: "closed",
		picked: null,
		draft: "",
		resumable: false,
	};
}

export function feedbackReducer<P>(
	state: FeedbackState<P>,
	action: FeedbackAction<P>,
): FeedbackState<P> {
	switch (action.type) {
		case "start":
			return {
				phase: "picking",
				picked: null,
				draft: "",
				resumable: false,
				session: state.session + 1,
			};
		case "pick":
			return { ...state, phase: "open", picked: action.picked };
		case "pick-again":
			return { ...state, phase: "picking", resumable: true };
		case "cancel-picking":
			return state.resumable ? { ...state, phase: "open" } : closed(state);
		case "draft":
			return { ...state, draft: action.value };
		case "close":
			return closed(state);
		case "finish":
			return action.session === state.session ? closed(state) : state;
		default:
			return state;
	}
}
