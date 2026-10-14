import assert from 'node:assert/strict';
import {
    RPCClient,
    RPCServer,
    NOREPLY,
    type RPCClientOptions,
    type RPCServerOptions,
    type RPCServerClient,
} from 'ocpp-rpc';

// Defaults must remain optional, while the client still requires its identity and URL.
const clientOptions: RPCClientOptions = {
    endpoint: 'ws://localhost:3000',
    identity: 'types-smoke',
};
const serverOptions: RPCServerOptions = {};
const client = new RPCClient(clientOptions);
const server = new RPCServer(serverOptions);
const defaultServer = new RPCServer();
client.reconfigure({callTimeoutMs: 500});
client.handle('Heartbeat', ({signal, messageId, reply}) => {
    const id: string = messageId;
    const aborted: boolean = signal.aborted;
    reply({currentTime: new Date().toISOString(), id, aborted});
});
client.handle(({method, params}) => ({method, params}));
client.handle('NoReply', () => NOREPLY);
server.auth((accept, reject, handshake, signal) => {
    const identity: string = handshake.identity;
    const password: Buffer | undefined = handshake.password;
    if (!signal.aborted && identity && !password) accept();
    else reject(401, 'Unauthorized');
});
server.on('client', (connected: RPCServerClient) => {
    const base: RPCClient = connected;
    base.handle('Heartbeat', () => ({currentTime: new Date().toISOString()}));
});
assert.ok(client instanceof RPCClient);
assert.equal(client.state, RPCClient.CLOSED);
await server.close();
await defaultServer.close();

// Checked but deliberately not executed: negative cases must fail at the consumer boundary.
function rejectedTypes() {
    // @ts-expect-error Required client options must not become optional.
    new RPCClient();
    // @ts-expect-error The client identity is required.
    new RPCClient({endpoint: 'ws://localhost:3000'});
    // @ts-expect-error Timeout options must be numeric.
    client.call('Heartbeat', {}, {callTimeoutMs: '500'});
    // @ts-expect-error Abort must use an AbortSignal.
    client.call('Heartbeat', {}, {signal: new AbortController()});
}
void rejectedTypes;
