import type { Spring } from "#/components/mascot/scripts";

export type Channel = { value: number; velocity: number };

export const channel = (value: number): Channel => ({ value, velocity: 0 });

export function stepSpring(c: Channel, target: number, s: Spring, dt: number) {
	const force = -s.stiffness * (c.value - target) - s.damping * c.velocity;
	c.velocity += force * dt;
	c.value += c.velocity * dt;
}
