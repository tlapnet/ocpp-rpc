import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {RPCClient} from '../lib/client.js';
import {RPCServer} from '../lib/server.js';
import {TimeoutError} from '../lib/errors.js';

describe('RPCClient call dispatch lifecycle', function () {
    this.timeout(2000);

    let server;
    let client;
    let connection;
    let acceptUpgrade;
    let received;

    async function start({holdUpgrade = false} = {}) {
        received = [];
        server = new RPCServer({pingIntervalMs: 0});
        let authReady;
        const auth = new Promise(resolve => { authReady = resolve; });
        server.auth(accept => {
            acceptUpgrade = accept;
            authReady();
            if (!holdUpgrade) accept();
        });
        server.on('client', peer => {
            peer.handle(({method, params}) => {
                received.push(method);
                return params;
            });
        });
        const httpServer = await server.listen(0);
        client = new RPCClient({
            endpoint: `ws://localhost:${httpServer.address().port}`,
            identity: 'dispatch-lifecycle',
            pingIntervalMs: 0,
            reconnect: false,
        });
        connection = client.connect();
        connection.catch(() => {});
        await auth;
        if (!holdUpgrade) await connection;
    }

    afterEach(async () => {
        // Observe orphan promises as well, so a failing cleanup assertion does
        // not produce unrelated unhandled rejections during test teardown.
        for (const pending of client?._pendingCalls.values() ?? []) {
            pending.promise.catch(() => {});
        }
        await client?.close({force: true});
        await server?.close({force: true});
    });

    it('cleans up when request serialization throws', async () => {
        await start();
        const {signal} = new AbortController();
        const circular = {};
        circular.self = circular;
        await assert.rejects(client.call('Echo', circular, {signal}), TypeError);
        assert.equal(client._pendingCalls.size, 0);
        assert.equal(getEventListeners(signal, 'abort').length, 0);
        assert.deepEqual(received, []);
    });

    it('cleans up when the WebSocket send throws synchronously', async () => {
        await start();
        const {signal} = new AbortController();
        const sendError = Error('synchronous send failure');
        const originalSend = client._ws.send;
        client._ws.send = () => { throw sendError; };
        try {
            await assert.rejects(client.call('Echo', {}, {signal}), error => error === sendError);
            assert.equal(client._pendingCalls.size, 0);
            assert.equal(getEventListeners(signal, 'abort').length, 0);
        } finally {
            client._ws.send = originalSend;
        }
    });

    it('does not deliver a request that timed out before connection opened', async () => {
        await start({holdUpgrade: true});
        await assert.rejects(client.call('SideEffect', {}, {callTimeoutMs: 20}), TimeoutError);
        const bufferedAfterTimeout = client._outboundMsgBuffer.length;
        acceptUpgrade();
        await connection;
        await client.call('Barrier', {});
        assert.deepEqual(received, ['Barrier']);
        assert.equal(bufferedAfterTimeout, 0);
    });

    it('does not deliver a request aborted before connection opened', async () => {
        await start({holdUpgrade: true});
        const controller = new AbortController();
        const rejection = assert.rejects(client.call('SideEffect', {}, {signal: controller.signal}), {
            name: 'AbortError',
        });
        controller.abort('cancel buffered request');
        await rejection;
        const bufferedAfterAbort = client._outboundMsgBuffer.length;
        acceptUpgrade();
        await connection;
        await client.call('Barrier', {});
        assert.deepEqual(received, ['Barrier']);
        assert.equal(bufferedAfterAbort, 0);
    });

    it('preserves other buffered calls when one request is cancelled', async () => {
        await start({holdUpgrade: true});
        client.reconfigure({callConcurrency: 2});
        const controller = new AbortController();
        const rejected = assert.rejects(client.call('Cancelled', {}, {signal: controller.signal}), {
            name: 'AbortError',
        });
        const kept = client.call('Kept', {value: 42});
        controller.abort();
        await rejected;
        acceptUpgrade();
        await connection;
        assert.deepEqual(await kept, {value: 42});
        assert.deepEqual(received, ['Kept']);
    });

    it('does not send a request cancelled from its outbound call event', async () => {
        await start();
        const controller = new AbortController();
        client.once('call', () => controller.abort('cancel before send'));
        await assert.rejects(client.call('SideEffect', {}, {signal: controller.signal}), {
            name: 'AbortError',
        });
        await client.call('Barrier', {});
        assert.deepEqual(received, ['Barrier']);
    });

    it('still delivers buffered noReply calls', async () => {
        await start({holdUpgrade: true});
        await client.call('FireAndForget', {}, {noReply: true});
        acceptUpgrade();
        await connection;
        await client.call('Barrier', {});
        assert.deepEqual(received, ['FireAndForget', 'Barrier']);
    });

    it('removes a request cancelled while the connection buffer is draining', async () => {
        await start({holdUpgrade: true});
        client.reconfigure({callConcurrency: 2});
        const controller = new AbortController();
        const first = client.call('First', {});
        const rejected = assert.rejects(client.call('CancelledBeforeDispatch', {}, {
            signal: controller.signal,
        }), {name: 'AbortError'});
        client.on('message', ({outbound, message}) => {
            if (outbound && JSON.parse(message)[2] === 'First') {
                controller.abort('cancel while flushing');
            }
        });
        acceptUpgrade();
        await connection;
        await first;
        await rejected;
        await client.call('Barrier', {});
        assert.deepEqual(received, ['First', 'Barrier']);
        assert.equal(client._outboundMsgBuffer.length, 0);
    });

    it('finishes buffered calls when graceful close starts while the buffer is draining', async () => {
        await start({holdUpgrade: true});
        client.reconfigure({callConcurrency: 2});
        const first = client.call('First', {}, {callTimeoutMs: 200});
        const second = client.call('Second', {}, {callTimeoutMs: 200});
        first.catch(() => {});
        second.catch(() => {});
        let closing;
        client.on('message', ({outbound, message}) => {
            if (outbound && JSON.parse(message)[2] === 'First') {
                closing = client.close({awaitPending: true});
            }
        });
        acceptUpgrade();
        await connection;
        await Promise.all([first, second]);
        await closing;
        assert.deepEqual(received, ['First', 'Second']);
        assert.equal(client.state, RPCClient.CLOSED);
        assert.equal(client._outboundMsgBuffer.length, 0);
    });
});
