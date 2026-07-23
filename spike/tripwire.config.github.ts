// The consumer config-file pattern: bind the forge once, export the surface.
import { github, Tripwire } from "./fixture.ts";

export const tripwire = new Tripwire({ forge: github, apiKey: "tw_fake" });
export const { rule, signals } = tripwire;
