import {isValidElement, type ComponentType, type ReactElement, type ReactNode} from 'react';

// Which part a child element is, for the few compound components that read their children before they
// render them (Tooltip's label, Wizard's steps).
//
// Why not `child.type === Part`: a child composed in a server component reaches a client component as a
// lazy client reference, not the function, so the comparison is false for every docs page and every
// server-rendered app screen, and works only when the parent is itself composed on the client. That bug
// shipped more than once, so every type check goes through isPart and nowhere else.
//
// The lazy wrapper is React's own object ({$$typeof: Symbol.for('react.lazy'), _payload, _init}); calling
// _init is how React itself resolves it, and once the client module has loaded it returns the function
// synchronously. It is not public API, so it lives here, in one place, and a change in React breaks one
// file. Components that can avoid reading their children should: Resizable registers its panels from
// context instead, and needs none of this.

const LAZY = Symbol.for('react.lazy');

type MaybeLazy = {$$typeof?: symbol; _init?: (payload: unknown) => unknown; _payload?: unknown};

/** The component behind an element's type, resolving a lazy client reference. */
function resolveType(type: unknown): unknown {
  const lazy = type as MaybeLazy | null;
  if (!lazy || typeof lazy !== 'object' || lazy.$$typeof !== LAZY || !lazy._init) return type;
  try {
    return lazy._init(lazy._payload);
  } catch {
    // Still loading: React throws the pending promise. The part cannot be known yet.
    return null;
  }
}

/** True when the node is an element of the given part, whether composed on the server or the client. */
export function isPart<P>(node: ReactNode, part: ComponentType<P>): node is ReactElement<P> {
  return isValidElement(node) && (node.type === part || resolveType(node.type) === part);
}
