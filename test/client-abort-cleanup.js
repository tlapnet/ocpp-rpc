import assert from 'node:assert/strict';
import { getEventListeners, once } from 'node:events';
import {RPCClient} from '../lib/client.js';
import {RPCServer} from '../lib/server.js';
import { TimeoutError, RPCError } from '../lib/errors.js';
import { NOREPLY } from '../lib/symbols.js';

describe('RPCClient call AbortSignal lifecycle', function () {
    this.timeout(2000);

    let server;
    let client;
    let peer;

    beforeEach(async () => {
        server = new RPCServer({pingIntervalMs: 0});
        server.on('client', connected => {
            peer = connected;
            peer.handle('Echo', ({params}) => params);
            peer.handle('Reject', () => { throw Error('Rejected by peer'); });
            peer.handle('NoReply', () => NOREPLY);
        });
        const httpServer = await server.listen(0);
        client = new RPCClient({
            endpoint: `ws://localhost:${httpServer.address().port}`,
            identity: 'abort-cleanup',
            reconnect: false,
            pingIntervalMs: 0,
        });
        await client.connect();
    });

    afterEach(async () => {
        await client?.close({force: true});
        await server?.close({force: true});
    });

    function assertClean(signal) {
        assert.equal(getEventListeners(signal, 'abort').length, 0);
        assert.equal(client._pendingCalls.size, 0);
    }

    it('removes listeners after repeated successful calls with a shared signal', async () => {
        const {signal} = new AbortController();
        for (let value = 0; value < 25; value++) {
            assert.equal(await client.call('Echo', value, {signal}), value);
        }
        assertClean(signal);
    });

    it('removes listeners after a remote CALLERROR', async () => {
        const {signal} = new AbortController();
        await assert.rejects(client.call('Reject', {}, {signal}), RPCError);
        assertClean(signal);
    });

    it('removes listeners after a timeout', async () => {
        const {signal} = new AbortController();
        await assert.rejects(client.call('NoReply', {}, {signal, callTimeoutMs: 20}), TimeoutError);
        assertClean(signal);
    });

    it('removes listeners when the local client closes', async () => {
        const {signal} = new AbortController();
        const rejection = assert.rejects(client.call('NoReply', {}, {signal}), {name: 'AbortError'});
        await client.close();
        await rejection;
        assertClean(signal);
    });

    it('removes listeners when the peer disconnects', async () => {
        const {signal} = new AbortController();
        const rejection = assert.rejects(client.call('NoReply', {}, {signal}), {name: 'AbortError'});
        await peer.close({force: true});
        await rejection;
        assertClean(signal);
    });

    it('preserves cancellation and the abort reason', async () => {
        const controller = new AbortController();
        const rejection = assert.rejects(client.call('NoReply', {}, {signal: controller.signal}), {
            name: 'AbortError',
            message: 'stop this call',
        });
        controller.abort('stop this call');
        await rejection;
        assertClean(controller.signal);
    });

    it('rejects an already-aborted call without sending it', async () => {
        const controller = new AbortController();
        controller.abort('already cancelled');
        const outbound = [];
        client.on('call', event => outbound.push(event));
        await assert.rejects(client.call('Echo', {}, {signal: controller.signal}), {
            name: 'AbortError',
            message: 'already cancelled',
        });
        assert.equal(outbound.length, 0);
        assertClean(controller.signal);
    });

    it('does not send a queued call aborted before dispatch', async () => {
        let releaseFirst;
        peer.handle('Wait', () => new Promise(resolve => { releaseFirst = resolve; }));
        const received = once(peer, 'call');
        const first = client.call('Wait', {});
        await received;
        const controller = new AbortController();
        const outbound = [];
        client.on('call', event => outbound.push(event));
        const queued = client.call('Echo', {}, {signal: controller.signal});
        const rejection = assert.rejects(queued, {name: 'AbortError', message: 'cancel queued'});
        controller.abort('cancel queued');
        releaseFirst({});
        await first;
        await rejection;
        assert.equal(outbound.length, 0);
        assertClean(controller.signal);
    });
});
