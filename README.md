# OCPP-RPC

[![Tests](https://github.com/tlapnet/ocpp-rpc/actions/workflows/test.yaml/badge.svg?branch=3.x)](https://github.com/tlapnet/ocpp-rpc/actions/workflows/test.yaml)

**Tlapnet 3.x development fork:** based on upstream's unreleased **3.0.0** work
at `9a8ef4a5e85e39b5def30588ab0b8c7ff04aef7f`, with our tested lifecycle fixes.
The package identifies itself as `3.0.0-tlapnet.0`; this is not an upstream or npm
release. The previous CommonJS implementation remains on branch `2.x`.
See [fork maintenance and installation](docs-src/fork-maintenance.md).

![OCPP-RPC](./assets/logo.png)

A client & server implementation of the WAMP-like RPC-over-websocket system defined in the [OCPP-J protocols](https://openchargealliance.org/protocols/) (e.g. [OCPP1.6J](https://openchargealliance.org/protocols/open-charge-point-protocol/#OCPP1.6), [OCPP2.0.1J](https://openchargealliance.org/protocols/open-charge-point-protocol/#OCPP2.0.1) and [OCPP2.1](https://openchargealliance.org/protocols/open-charge-point-protocol/#OCPP2.1)).

Requires Node.js >= 20

This module is built for Node.js and does not currently work in browsers.

## Who is this for?

* Anyone building an OCPP-based Charging Station or Charging Station Management System (CSMS) using Node.js.
* Anyone looking for a simple yet robust symmetrical RPC framework that runs over WebSockets.

## Features

* 🛂 **Authentication** - Optional authentication step for initiating session data and filtering incoming clients.
* 🔒 **[OCPP Security](#ocpp-security)** - Compatible with OCPP security profiles 1, 2 & 3.
* 💬 **Serve multiple subprotocols** - Simultaneously serve multiple different subprotocols from the same service endpoint.
* ✅ **[Strict Validation](#strict-validation)** - Optionally enforce subprotocol schemas to prevent invalid calls & responses.
* **Automatic reconnects** - Client supports automatic exponential-backoff reconnects.
* **Automatic keep-alive** - Regularly performs pings, and drops dangling TCP connections.
* **Graceful shutdowns** - Supports waiting for all in-flight messages to be responded to before closing sockets.
* **Clean closing of websockets** - Supports sending & receiving WebSocket close codes & reasons.
* **Embraces abort signals** - `AbortSignal`s can be passed to most async methods.
* **Optional HTTP server** - Bring your own HTTP server if you want to, or let `RPCServer` create one for you.

## Installing

```sh
npm install --save-exact 'git+https://github.com/tlapnet/ocpp-rpc.git#FULL_COMMIT_SHA'
```

Use a reviewed full commit SHA and commit your application's lockfile. Git
installation runs `prepare` to generate TypeScript declarations. Installing
`ocpp-rpc` from npm still selects the separately released upstream version.

## Usage Examples

See the **[Getting Started](https://mikuso.github.io/ocpp-rpc/documents/Getting_Started.html)** guide in the API docs.

## API Docs

Full **[API documentation and guides](https://mikuso.github.io/ocpp-rpc/modules.html)** are available.

## Upgrading from an older version?

See the **[Upgrade guide](https://mikuso.github.io/ocpp-rpc/documents/Upgrading_previous_versions.html)**.

## Licenses

- **ocpp-rpc:** Licensed under the [MIT License](./LICENSE.md)
- **OCPP 1.6, OCPP 2.0.1 & OCPP 2.1 JSON schemas:** Licensed from the Open Charge Alliance under [Creative Commons Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0)](./schemas/openchargealliance/LICENSE.md).
