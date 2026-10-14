import assert = require('node:assert/strict');

// Node16/NodeNext must preserve import() inside a CommonJS consumer of this ESM package.
async function main() {
    const {RPCClient, RPCServer} = await import('ocpp-rpc');
    const client = new RPCClient({endpoint: 'ws://localhost:3000', identity: 'cjs-smoke'});
    const server = new RPCServer();
    client.handle('Heartbeat', ({signal, reply}) => {
        const aborted: boolean = signal.aborted;
        reply({currentTime: new Date().toISOString(), aborted});
    });
    assert.ok(client instanceof RPCClient);
    assert.equal(client.state, RPCClient.CLOSED);
    await server.close();
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
