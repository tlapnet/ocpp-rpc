import assert from 'node:assert/strict';
import {once} from 'node:events';
import {RPCClient} from '../lib/client.js';
import {RPCServer} from '../lib/server.js';

describe('RPCClient inbound calls across reconnect', function () {
    this.timeout(2000);

    let server;
    let client;
    let peers;
    let gates;
    let badMessages;

    beforeEach(async () => {
        peers = [];
        gates = [];
        badMessages = [];
        server = new RPCServer({pingIntervalMs: 0});
        server.on('client', peer => {
            peers.push(peer);
            peer.handle('Barrier', () => ({}));
            peer.on('badMessage', event => badMessages.push(event));
        });
        const httpServer = await server.listen(0);
        client = new RPCClient({
            endpoint: `ws://localhost:${httpServer.address().port}`,
            identity: 'reconnect-lifecycle',
            pingIntervalMs: 0,
            backoff: {initialDelay: 1, maxDelay: 2, factor: 2, randomisationFactor: 0},
        });
        client.handle('Hold', ({signal}) => new Promise((resolve, reject) => {
            // Deliberately ignore cancellation, as an application handler may do.
            gates.push({resolve, reject, signal});
        }));
        await client.connect();
    });

    afterEach(async () => {
        await client?.close({force: true});
        for (const gate of gates) gate.resolve({});
        await server?.close({force: true});
    });

    async function beginCall() {
        const received = once(client, 'call');
        const call = peers.at(-1).call('Hold', {});
        call.catch(() => {});
        await received;
        const [pending] = client._pendingResponses.values();
        return {call, pending, gate: gates.at(-1)};
    }

    async function reconnect() {
        const reopened = once(client, 'open');
        await peers.at(-1).close({force: true});
        await reopened;
        assert.equal(peers.length, 2);
    }

    for (const outcome of ['result', 'error']) {
        it(`does not send a late ${outcome} on the replacement connection`, async () => {
            const {call, pending, gate} = await beginCall();
            await reconnect();
            assert.equal(gate.signal.aborted, true);
            if (outcome === 'result') gate.resolve({late: true});
            else gate.reject(Error('late handler error'));
            await pending.promise.catch(() => {});
            await client.call('Barrier', {});
            await assert.rejects(call, {name: 'AbortError'});
            assert.deepEqual(badMessages, []);
            assert.equal(client.state, RPCClient.OPEN);
            assert.equal(client._pendingResponses.size, 0);
        });
    }

    it('releases abandoned responses at disconnect even if handlers never settle', async () => {
        const {call, gate} = await beginCall();
        await reconnect();
        await assert.rejects(call, {name: 'AbortError'});
        assert.equal(gate.signal.aborted, true);
        assert.equal(client._pendingResponses.size, 0);
    });

    it('does not close the replacement connection when a stale error cannot be formatted', async () => {
        const {pending, gate} = await beginCall();
        await reconnect();
        const error = Error('late error');
        Object.defineProperty(error, 'details', {get() { throw Error('details unavailable'); }});
        gate.reject(error);
        await pending.promise.catch(() => {});
        assert.equal(client.state, RPCClient.OPEN);
        await client.call('Barrier', {});
        assert.equal(client.state, RPCClient.OPEN);
    });

    it('keeps a new call with the same message ID when the old handler settles', async () => {
        const messageId = 'reused-id';
        peers[0].sendRaw(JSON.stringify([2, messageId, 'Hold', {}]));
        await client.call('Barrier', {});
        const oldPending = client._pendingResponses.get(messageId);
        const oldGate = gates[0];
        assert.ok(oldPending);
        await reconnect();
        peers[1].sendRaw(JSON.stringify([2, messageId, 'Hold', {}]));
        await client.call('Barrier', {});
        const newPending = client._pendingResponses.get(messageId);
        assert.ok(newPending);
        assert.notEqual(newPending, oldPending);
        oldGate.resolve({old: true});
        await oldPending.promise;
        await client.call('Barrier', {});
        assert.equal(client._pendingResponses.get(messageId), newPending);
        gates[1].resolve({new: true});
        await newPending.promise;
        await client.call('Barrier', {});
        assert.equal(client._pendingResponses.size, 0);
    });

    it('still sends pending replies during graceful close on the original connection', async () => {
        const {call, gate} = await beginCall();
        const closing = client.close({awaitPending: true});
        assert.equal(client.state, RPCClient.CLOSING);
        assert.equal(gate.signal.aborted, false);
        gate.resolve({completed: true});
        assert.deepEqual(await call, {completed: true});
        await closing;
        assert.equal(client.state, RPCClient.CLOSED);
        assert.deepEqual(badMessages, []);
    });
});
