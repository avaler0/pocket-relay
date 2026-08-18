# Pocket Relay

Pocket Relay is a small offline-first terminal chat for the [Bare JavaScript runtime](https://github.com/holepunchto/bare). It sends the same room history over two independent peer-to-peer paths:

- [Hyperswarm](https://github.com/holepunchto/hyperswarm) for internet discovery and Noise-encrypted duplex connections.
- [BLE Swarm](https://github.com/holepunchto/ble-swarm) for nearby discovery and Noise-encrypted duplex connections on supported devices.

BLE Swarm is experimental. Pocket Relay uses only its documented constructor, `connection`/`update` events, `state`, `peers`, `start()`, `stop()`, and `setOnline()` behavior. BLE Swarm currently documents macOS 13+, iOS, and Android support; it reports `unsupported` elsewhere. On macOS, Apple's host application must also contain `NSBluetoothAlwaysUsageDescription`. The stock `bare` CLI executable does not, so Pocket Relay detects that host and leaves BLE disabled instead of allowing macOS privacy enforcement to abort the entire internet-capable process. A packaged/embedded Bare host with the usage description can start BLE.

## Install and run

Install Bare and the dependencies:

```bash
npm install -g bare
npm install
```

Start a named peer in an existing room:

```bash
bare app.js --name Alice --room <64-character-room-topic>
```

Or create a new room:

```bash
bare app.js --name Alice
```

When `--room` is omitted, Pocket Relay generates and prints a cryptographically random 32-byte topic. The topic is an invite and discovery token, not a password: anyone who learns it can discover and participate in the room.

Useful package scripts invoke Bare, never Node:

```bash
npm start -- --name Alice --room <topic>
npm test
npm run smoke:hyperswarm
```

### Package for macOS BLE

The stock macOS `bare` CLI has no application privacy metadata, so build the universal terminal app bundle before using BLE:

```bash
npm run package:mac
npm run verify:mac
```

This creates `dist/Pocket Relay.app` for both Apple Silicon and Intel and ad-hoc signs the bundle. Its Info.plist includes `NSBluetoothAlwaysUsageDescription` and `NSBluetoothPeripheralUsageDescription`.

The packaging command builds in a fresh macOS temporary directory and only moves the completed bundle into `dist`. It also places `scripts/macos-tools` first on its private `PATH`; its `codesign` wrapper removes resource-fork and Finder extended attributes from each generated signing target, then delegates unchanged arguments to `/usr/bin/codesign`. Together these prevent Apple code-signing failures caused by stale build artifacts, iCloud-managed project folders, or stricter macOS extended-attribute validation. This build-only workaround does not affect application runtime behavior.

`bare-build` is packaging tooling and currently has a Node-based CLI; it never runs Pocket Relay application code or tests. The resulting app embeds the Bare runtime, and all application/test execution remains on Bare.

Pocket Relay remains a terminal application. The launcher starts the bundle through macOS LaunchServices (so privacy metadata is recognized) while connecting its input and output to the current terminal:

```bash
npm run start:mac -- --name Alice --room <topic>
```

On first BLE use, macOS should ask for Bluetooth permission. Approve it under **System Settings → Privacy & Security → Bluetooth** if necessary. Do not launch the `.app` by double-clicking it in Finder; the current interface requires terminal input and output.

## Commands

| Command | Effect |
| --- | --- |
| `/help` | Show commands |
| `/status` | Show BLE state and connected peer counts by transport |
| `/peers` | List full Noise peer keys and their transports |
| `/history` | Show the canonical one-copy-per-ID message history |
| `/deliveries` | Show every send and arrival, including duplicates |
| `/invite` | Print the room topic and token warning |
| `/quit` | Stop both transports, flush storage, and exit |

Every other non-empty line is a chat message. If there is no active connection it is persisted and displayed as `[LOCAL/QUEUED]`; it is sent when a peer connects later.

## Transport and duplicate behavior

One persistent random 32-byte seed produces the Hyperswarm Noise keypair with `hypercore-crypto.keyPair(seed)`. The exact same keypair and the exact same 32-byte room topic are passed to Hyperswarm and BLE Swarm. Hyperswarm joins with `{ server: true, client: true }`.

Both adapters produce the same application-level connection shape while retaining `ble` or `internet` as an immutable transport label. The chat layer uses newline-delimited JSON and a byte-oriented decoder, so split and combined stream chunks are handled correctly. Frames above 64 KiB, invalid JSON, invalid public keys, unsafe terminal control characters, and messages above 4 KiB are rejected without terminating the app.

A new unique message is added to canonical history, recorded as a delivery, displayed, and forwarded to every other active connection. The source connection is excluded. Each connection has its own sent-ID set, so history or forwarding is never written twice to that connection.

A later arrival with an existing ID is still recorded and displayed, including its transport:

```text
[BLE ← a921bd] Bob: Meet at 18:00
[DUPLICATE] [INTERNET ← a921bd] Bob: Meet at 18:00
```

It is not added to canonical history and is not forwarded again. Outgoing BLE and internet writes are also displayed separately.

## Architecture

- `app.js` owns argument parsing, Bare TTY/readline setup, commands, signals, and final `Bare.exit()`.
- `src/chat-state.js` is the transport-independent canonical store, connection registry, deduplicator, delivery recorder, history synchronizer, and store-and-forward relay.
- `src/protocol.js` validates chat objects and incrementally encodes/decodes NDJSON frames.
- `src/persistence.js` uses `bare-storage`, `bare-path`, and `bare-fs` for a persistent identity and room-scoped JSONL files.
- `src/transports/hyperswarm.js` and `src/transports/ble.js` are thin lifecycle adapters.
- `src/terminal.js` owns transport colors and prompt-safe asynchronous output.
- `test/all.js` tests the chat layer with Bare `Duplex` fakes and exercises real Bare filesystem persistence.
- `test/hyperswarm-smoke.js` creates a local three-node DHT testnet and verifies actual Hyperswarm discovery, Noise connections, and payload transfer under Bare.

## Storage

`bare-storage.persistent()` selects the platform application-data root. Pocket Relay creates this layout beneath it:

```text
pocket-relay/
  identity-seed
  rooms/<topic-hex>/
    messages.jsonl
    deliveries.jsonl
```

The identity seed is global to the installation and written with owner-only mode where the platform honors POSIX modes. Canonical messages and delivery events are room-scoped. JSONL appends are serialized and flushed before shutdown. No identity or chat data is written into this repository; the corresponding local development names are also ignored by `.gitignore`.

## Tests

Run the full suite exactly as the application runtime requires:

```bash
bare test/all.js
```

The suite asserts that it is running under Bare and that no Node `process` global exists. It covers first and duplicate arrivals, canonical and delivery-log cardinality, separate sends and terminal entries for both transports, no duplicate forwarding, unique forwarding, late-peer history synchronization, split/combined framing, malformed and oversized input, unsupported BLE fallback, actual Bare filesystem persistence, and complete shutdown.

Run the practical local networking check:

```bash
bare test/hyperswarm-smoke.js
```

This binds loopback UDP sockets and uses `@hyperswarm/testnet`; a sandbox or firewall must allow local UDP.

## Manual verification

### Two processes over Hyperswarm

On one internet-connected machine, start Alice without a topic and copy the printed room value:

```bash
bare app.js --name Alice
```

Start Bob, on the same or a different internet-connected machine:

```bash
bare app.js --name Bob --room <Alice's-topic>
```

Wait for `/status` to show internet peers, send in both directions, then inspect `/history` and `/deliveries`.

### Two physical devices over BLE

Use two physical devices supported by `bare-bluetooth`/BLE Swarm, grant Bluetooth permission, and start both with the same room topic in a Bare host carrying the platform Bluetooth permission metadata. On macOS, use `npm run package:mac` and `npm run start:mac -- ...`; the stock `bare` CLI cannot safely request CoreBluetooth access. Disconnect internet on both devices, confirm `/status` reports BLE on with peers, then send in both directions. Do not treat a simulator, a single device, or the fake-stream suite as physical BLE verification.

### Both transports and duplicate evidence

Put two supported devices near each other, keep internet enabled, and join the same topic. After `/status` reports both peer types, send one message. The sender should print a distinct BLE send and internet send. The receiver should show the first arrival normally and the later path as `[DUPLICATE]`; `/deliveries` should contain both while `/history` contains one canonical message.

### Internet loss followed by BLE

Connect two nearby supported devices with both paths, then disable internet or make Hyperswarm unreachable without stopping the apps. Confirm BLE remains available in `/status`, send a message, and verify a BLE arrival. Restore internet and inspect later history synchronization/duplicate delivery evidence.

### Three-peer store-and-forward

1. Put A and B in the same room with internet disabled and BLE available.
2. Send a message from A and confirm B receives and stores it over BLE.
3. Move B away from A or stop A. Enable internet on B.
4. Start C with the same topic and internet access.
5. When B and C connect through Hyperswarm, B's connection-time history synchronization should send A's stored message to C over the internet.
6. Confirm C's canonical history contains A's message and its delivery log labels the arrival `INTERNET`.

## Current limitations

- Physical BLE behavior depends on the experimental BLE Swarm and `bare-bluetooth` platform support, radio state, and permissions. Automated tests use fake duplexes; they do not claim physical BLE verification.
- The stock macOS `bare` CLI lacks Apple's required Bluetooth usage-description metadata. Pocket Relay proactively reports BLE as unavailable in that host while keeping Hyperswarm live; physical macOS BLE needs a packaged/embedded Bare host with `NSBluetoothAlwaysUsageDescription`.
- The generated macOS bundle is ad-hoc signed for local development. Distributing it to other Macs without Gatekeeper warnings requires an Apple Developer ID signature and notarization.
- Message bodies are not separately signed. Noise authenticates each direct connection, but a store-and-forward peer can relay an `author`/`authorKey` claim. Add message signatures before treating authorship as cryptographic proof.
- JSONL is intentionally lightweight. There is no compaction, retention limit, multi-process file locking, Corestore, or Autobase in this version.
- A random message-ID collision or a malicious reused ID is treated as a duplicate.
- `bare-readline` currently has no public “print above prompt while preserving a wrapped edit” API. `src/terminal.js` uses its inspected current rendered-row field solely to redraw asynchronous network output. This is a small Bare-terminal workaround, not a Node compatibility shim, and may need adjustment if `bare-readline` changes.

## License

Pocket Relay is licensed under the [Apache License 2.0](LICENSE).
