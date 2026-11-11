# WizLight companion connection

Status: design only. Spotlight does not currently connect to, discover or control WizLight or any light. The local WizLight project is still under development. Its documented desktop interface offers GUI and CLI presets, and bulbs are controlled over local UDP; it does not document a browser-facing integration interface. Do not construct commands from a title name or expose the CLI directly to a website.

## First usable integration

1. The viewer opens WizLight themselves and enables the Spotlight companion connection in that app. The default is off. WizLight presents a pairing flow that identifies the Spotlight origin and requires a deliberate local confirmation before granting control.
2. Spotlight presents a small, fixed set of locally defined, clearly labelled static scene suggestions. The viewer selects a scene and chooses **Apply**; title metadata is not a command and no light changes on page load. The request contains a versioned scene ID, not arbitrary shell arguments, code, a bulb IP address or a user credential.
3. WizLight validates the paired origin and request, maps the scene ID to a locally controlled preset, and shows which bulbs are selected. Network access and actual bulb control remain on the viewer's device and local network. Spotlight must not send device addresses or bulb states to its servers.
4. Before applying, WizLight captures the selected bulbs' current states. It reports per-bulb success or failure; Spotlight shows partial success rather than claiming the whole scene applied. If the state cannot be read, explain that restoration is unavailable before any change.
5. **Stop** ends only the session started by this connection. **Restore** explicitly requests the captured state and reports per-bulb outcomes. Neither assumes that a disconnected bulb was restored. A user override made in WizLight after applying a scene must not silently be overwritten by a stale automatic restore.

## Security and privacy requirements

- Bind any companion listener only to loopback, disabled until the user enables it. Treat every browser origin, including another tab on the same computer, as untrusted. Loopback alone is not authentication.
- Require explicit pairing, allow only the exact paired HTTPS Spotlight origin, and reject unknown origins and unauthenticated requests. No wildcard CORS. Validate the request host as well as the origin to address DNS rebinding; browser private-network access restrictions and secure-context requirements must be verified on supported browsers.
- Use a high-entropy, revocable, per-installation credential with a short pairing lifetime and no secret in URLs, logs, shared plans or analytics. Do not expose arbitrary local-network requests, commands, file access, discovery or screen capture. Rate-limit and validate a bounded allowlist of scene IDs and payload sizes.
- Pairing and permission state live on the user's device; an unpaired, unavailable, rejected or outdated companion produces a clear manual fallback. Do not automatically retry a state-changing action after a timeout, because the companion may have applied it even if the response was lost.
- No background control, audio capture or screen capture is required for the first release. Screen synchronization remains a separately initiated WizLight function.

## Gates before enabling

- Confirm the companion project has a stable, documented interface and coordinate changes with its ongoing work. Do not overwrite its working-tree changes.
- Verify pairing, origin and host rejection, malformed requests, revocation, repeated requests, and disabled-listener behavior with a fake companion; cover browser permission and unavailable-app states.
- Exercise apply, partial failure, manual override, stop and restore against simulated bulbs first. Only test real hardware with an explicit user-initiated action and a way to restore its state.
- Validate Windows and supported browsers, mobile fallback, accessibility, failure messages and the privacy disclosure. Do not enable the feature merely because an executable is installed.

The current WizLight repository documents the GUI and `wizlight preset` in its README and `docs/commands.md`, and its `docs/production-validation.md` lists separate manual, packaging and hardware gates. Those facts establish a possible companion, not proof that the browser connection or restore flow exists.
