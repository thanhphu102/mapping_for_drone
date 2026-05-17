# Maintainer Documentation

This documentation set is organized using the Diataxis framework so contributors can quickly find the right type of information.
It is now tuned for web engineering work: HTTP/WebSocket contracts, browser behavior, performance, accessibility, and security hardening.

## Audience and Goal

- Audience: developers maintaining this prototype and adding new swarm features.
- Goal: understand current architecture, modify behavior safely, and implement new features with confidence.

## Documentation Map

- Tutorial: [tutorial-first-change.md](tutorial-first-change.md)
  - Learn the development loop by making a small, safe backend+frontend change.
- How-to: [how-to-add-feature.md](how-to-add-feature.md)
  - Step-by-step recipes for implementing common feature types.
- Reference: [reference-system.md](reference-system.md)
  - API contracts, runtime components, state model, and key files.
- Explanation: [explanation-architecture.md](explanation-architecture.md)
  - Why the architecture is designed this way and its current trade-offs.
- Branch Explanation: [explanation-map-canvas-branch-changes.md](explanation-map-canvas-branch-changes.md)
  - What changed in the `map-canvas` branch and what reviewers should verify.

## Scope

Included:
- Runtime architecture (frontend, backend, simulator)
- WebSocket and REST message flow
- Extension points for new features
- Operational commands and troubleshooting
- Browser compatibility and frontend runtime behavior
- Baseline web security and transport guidance
- Client-side performance and rendering considerations
- Accessibility checks for UI changes

Excluded:
- Production-grade security implementation details
- Drone hardware integration specifics
- CI/CD and deployment pipelines
