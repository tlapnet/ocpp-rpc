import assert = require('node:assert/strict');

// Node16/NodeNext must preserve import() inside a CommonJS consumer of this ESM package.
async function main() {
    const {RPCClient, RPCServer} = await import('ocpp-rpc');
    const client = new RPCClient({identity: 'cjs-smoke'});
    client.reconfigure({endpoint: 'ws://localhost:3000'});
    const server = new RPCServer();
    client.handle('Heartbeat', ({signal, reply}) => {
        const aborted: boolean = signal.aborted;
        reply({currentTime: new Date().toISOString(), aborted});
    });
    assert.ok(client instanceof RPCClient);
    assert.equal(client.state, RPCClient.CLOSED);
    await server.close();

    // Checked but deliberately not executed: accepting a deferred endpoint must not weaken types.
    function rejectedTypes() {
        // @ts-expect-error The client identity is required.
        new RPCClient({endpoint: 'ws://localhost:3000'});
        // @ts-expect-error An optional endpoint must still be a string.
        new RPCClient({identity: 'invalid-endpoint', endpoint: 3000});
        // @ts-expect-error Partial reconfiguration must preserve endpoint's type.
        client.reconfigure({endpoint: 3000});
    }
    void rejectedTypes;
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
