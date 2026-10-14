const assert = require('assert/strict');
const {getEventListeners} = require('events');
const RPCClient = require('../lib/client');
const RPCServer = require('../lib/server');

describe('RPCClient connecting call cleanup', function () {
    this.timeout(2000);

    let server;
    let client;
    let connection;
    let rejectUpgrade;
    let controllers;
    let received;

    beforeEach(async () => {
        controllers = [];
        received = [];
        let authReady;
        const auth = new Promise(resolve => { authReady = resolve; });
        server = new RPCServer({pingIntervalMs: 0});
        server.auth((accept, reject) => {
            rejectUpgrade = reject;
            authReady();
        });
        server.on('client', peer => peer.handle(({method}) => {
            received.push(method);
            return {};
        }));
        const httpServer = await server.listen(0);
        client = new RPCClient({
            endpoint: `ws://localhost:${httpServer.address().port}`,
            identity: 'connecting-cleanup',
            reconnect: false,
            pingIntervalMs: 0,
        });
        connection = client.connect();
        connection.catch(() => {});
        await auth;
    });

    afterEach(async () => {
        for (const controller of controllers) controller.abort('test cleanup');
        await client?.close({force: true});
        await server?.close({force: true});
    });

    function callWhileConnecting() {
        const controller = new AbortController();
        controllers.push(controller);
        const call = client.call('SideEffect', {}, {signal: controller.signal, callTimeoutMs: Infinity});
        call.catch(() => {});
        return {call, signal: controller.signal};
    }

    function assertClean(signal) {
        assert.equal(client.state, RPCClient.CLOSED);
        assert.equal(client._pendingCalls.size, 0);
        assert.equal(client._outboundMsgBuffer.length, 0);
        assert.equal(getEventListeners(signal, 'abort').length, 0);
    }

    for (const options of [{}, {force: true}, {awaitPending: true}]) {
        it(`rejects pending and queued calls when connecting is closed with ${JSON.stringify(options)}`, async () => {
            const first = callWhileConnecting();
            const second = callWhileConnecting();
            await client.close(options);
            await assert.rejects(connection);
            assertClean(first.signal);
            assertClean(second.signal);
            await assert.rejects(first.call, {name: 'AbortError'});
            await assert.rejects(second.call);
        });
    }

    it('rejects pending calls when the initial handshake fails', async () => {
        const {call, signal} = callWhileConnecting();
        rejectUpgrade(403, 'Rejected for test');
        await assert.rejects(connection);
        assertClean(signal);
        await assert.rejects(call, {name: 'AbortError'});
    });

    for (const outcome of ['close', 'failure']) {
        it(`discards buffered noReply and raw messages on ${outcome} before a later connection`, async () => {
            await client.call('NoReplySideEffect', {}, {noReply: true});
            client.sendRaw(JSON.stringify([2, 'raw-call', 'RawSideEffect', {}]));
            if (outcome === 'close') await client.close();
            else rejectUpgrade(403, 'Rejected for test');
            await assert.rejects(connection);
            const buffered = client._outboundMsgBuffer.length;
            server.auth(accept => accept());
            await client.connect();
            await client.call('Barrier', {});
            assert.deepEqual(received, ['Barrier']);
            assert.equal(buffered, 0);
        });
    }
});
