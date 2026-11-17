// Session posture and the lifecycle machine's structure, without xstate.
// These are needed by boot screens before the main interpreter loads, so they
// live in an xstate-free module that cortex-navigation.js re-exports from.

export function authPosture(session, promote = false) {
  if (!session) return "anonymous";
  if (session.user?.guest) return promote && !session.committed ? "anonymous" : "guest";
  return "user";
}

export const SESSION_LIFECYCLE_CHART = Object.freeze({
  id: "session",
  states: {
    anonymous: {
      initial: "idle",
      states: {
        idle: {},
        authenticating: {},
        registering: {},
        failed: {},
      },
    },
    guest: {
      initial: "idle",
      states: {
        idle: {},
        authenticating: {},
        registering: {},
        failed: {},
      },
    },
    user: {
      initial: "idle",
      states: {
        idle: {},
        authenticating: {},
        registering: {},
        failed: {},
      },
    },
    signingOut: {},
  },
});
