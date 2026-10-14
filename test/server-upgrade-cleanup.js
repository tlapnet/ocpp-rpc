const assert = require('assert/strict');
const {getEventListeners, once} = require('events');
const {setImmediate} = require('timers/promises');
const {execFile} = require('child_process');
const {promisify} = require('util');
const RPCClient = require('../lib/client');
const RPCServer = require('../lib/server');

describe('RPCServer lifecycle cleanup', function () {
    this.timeout(2000);

    async function connection(options = {}, auth) {
        const server = new RPCServer(options);
        if (auth) server.auth(auth);
        const httpServer = await server.listen(0, '127.0.0.1');
        const client = new RPCClient({
            endpoint: `ws://127.0.0.1:${httpServer.address().port}`,
            identity: 'cleanup',
            reconnect: false,
            protocols: options.protocols,
        });
        const aborts = [];
        server.on('upgradeAborted', event => aborts.push(event));
        return {server, client, aborts};
    }

    async function close({server, client}) {
        await client.close({force: true, awaitPending: false});
        await server.close({force: true, awaitPending: false});
    }

    it('does not abort a completed upgrade when the transport later fails', async () => {
        let socket, authSignal;
        const ctx = await connection({}, (accept, reject, handshake, signal) => {
            socket = handshake.request.socket;
            authSignal = signal;
            accept();
        });
        try {
            await ctx.client.connect();
            const closed = once(ctx.client, 'close');
            socket.emit('error', new Error('late transport failure'));
            await closed;
            assert.equal(ctx.aborts.length, 0);
            assert.equal(authSignal.aborted, false);
        } finally {
            await close(ctx);
        }
    });

    it('ignores a rejected auth promise after a completed upgrade', async () => {
        let finishAuth;
        const authPending = new Promise(resolve => { finishAuth = resolve; });
        const ctx = await connection({}, async accept => {
            accept();
            await authPending;
            throw new Error('auth callback failed after accepting');
        });
        ctx.server.on('client', client => client.handle('Echo', ({params}) => params));
        try {
            await ctx.client.connect();
            finishAuth();
            await setImmediate();
            assert.equal(ctx.aborts.length, 0);
            assert.deepEqual(await ctx.client.call('Echo', {alive: true}), {alive: true});
        } finally {
            finishAuth();
            await close(ctx);
        }
    });

    it('still aborts authentication on a socket error before upgrade', async () => {
        let authSignal;
        const failure = new Error('transport failure during authentication');
        const ctx = await connection({}, (accept, reject, handshake, signal) => {
            authSignal = signal;
            handshake.request.socket.emit('error', failure);
        });
        try {
            await assert.rejects(ctx.client.connect());
            assert.equal(ctx.aborts.length, 1);
            assert.equal(ctx.aborts[0].error, failure);
            assert.equal(authSignal.reason, failure);
        } finally {
            await close(ctx);
        }
    });

    it('still reports authentication rejection exactly once', async () => {
        let authSignal;
        const ctx = await connection({}, (accept, reject, handshake, signal) => {
            authSignal = signal;
            reject(403, 'Denied');
            reject(403, 'Denied again');
        });
        try {
            await assert.rejects(ctx.client.connect());
            await setImmediate();
            assert.equal(ctx.aborts.length, 1);
            assert.equal(ctx.aborts[0].error.code, 403);
            assert.equal(authSignal.aborted, true);
        } finally {
            await close(ctx);
        }
    });

    it('aborts when the peer disconnects while WebSocket verification is pending', async () => {
        let verifyStarted;
        const verifying = new Promise(resolve => { verifyStarted = resolve; });
        let authSignal, peerEnded, socket, finishVerification;
        const ctx = await connection({wssOptions: {
            verifyClient(info, done) {
                finishVerification = done;
                verifyStarted();
            },
        }}, (accept, reject, handshake, signal) => {
            authSignal = signal;
            socket = handshake.request.socket;
            peerEnded = once(socket, 'end');
            accept();
        });
        try {
            const connecting = ctx.client.connect().catch(error => error);
            await verifying;
            await ctx.client.close({force: true, awaitPending: false});
            await connecting;
            await peerEnded;
            assert.equal(ctx.aborts.length, 1);
            assert.equal(authSignal.aborted, true);
            assert.doesNotThrow(() => finishVerification(true));
        } finally {
            socket?.destroy();
            await close(ctx);
        }
    });

    it('removes the listen AbortSignal listener after each HTTP server closes', async () => {
        const ac = new AbortController();
        const server = new RPCServer();
        const initial = getEventListeners(ac.signal, 'abort').length;
        try {
            for (let i = 0; i < 5; i++) {
                const httpServer = await server.listen(0, '127.0.0.1', {signal: ac.signal});
                await new Promise((resolve, reject) => {
                    httpServer.close(error => error ? reject(error) : resolve());
                });
                assert.equal(getEventListeners(ac.signal, 'abort').length, initial);
            }
        } finally {
            await server.close();
        }
    });

    it('preserves protocol and session through asynchronous WebSocket verification', async () => {
        const ctx = await connection({
            protocols: ['ocpp1.6'],
            wssOptions: {
                verifyClient(info, done) { setImmediate().then(() => done(true)); },
            },
        }, accept => accept({verified: true}));
        try {
            const connected = once(ctx.server, 'client');
            await ctx.client.connect();
            const [serverClient] = await connected;
            assert.equal(serverClient.protocol, 'ocpp1.6');
            assert.deepEqual(serverClient.session, {verified: true});
            assert.equal(ctx.aborts.length, 0);
        } finally {
            await close(ctx);
        }
    });

    it('rejects listen with an already aborted signal without opening a port', async () => {
        const ac = new AbortController();
        const reason = new Error('already cancelled');
        ac.abort(reason);
        const server = new RPCServer();
        try {
            await assert.rejects(server.listen(0, '127.0.0.1', {signal: ac.signal}), error => error === reason);
            assert.equal(getEventListeners(ac.signal, 'abort').length, 0);
            assert.equal(server._httpServerAbortControllers.size, 0);
        } finally {
            await server.close();
        }
    });

    it('settles listen and releases its signal listener when aborted during startup', async () => {
        const ac = new AbortController();
        const reason = new Error('cancelled during startup');
        const server = new RPCServer();
        try {
            const listening = server.listen(0, '127.0.0.1', {signal: ac.signal});
            ac.abort(reason);
            await assert.rejects(listening, error => error === reason);
            await setImmediate();
            assert.equal(getEventListeners(ac.signal, 'abort').length, 0);
            assert.equal(server._httpServerAbortControllers.size, 0);
        } finally {
            await server.close();
        }
    });

    it('does not leave a listening HTTP server after startup abort', async function () {
        this.timeout(8000);
        // A leaked listener keeps the child alive after all public cleanup has
        // completed. Use the running Node version, including older supported ones.
        const script = `
            const RPCServer = require(${JSON.stringify(require.resolve('../lib/server'))});
            (async () => {
                const server = new RPCServer();
                const ac = new AbortController();
                const listening = server.listen(0, '127.0.0.1', {signal: ac.signal});
                ac.abort(new Error('cancelled during DNS lookup'));
                await listening.catch(() => {});
                await server.close();
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        await promisify(execFile)(process.execPath, ['-e', script], {timeout: 5000});
    });

    it('rejects a failed bind and releases its signal listener', async () => {
        const ac = new AbortController();
        const server = new RPCServer();
        const occupied = await server.listen(0, '127.0.0.1');
        try {
            await assert.rejects(
                server.listen(occupied.address().port, '127.0.0.1', {signal: ac.signal}),
                {code: 'EADDRINUSE'}
            );
            assert.equal(getEventListeners(ac.signal, 'abort').length, 0);
            assert.equal(server._httpServerAbortControllers.size, 1);
        } finally {
            await server.close();
        }
    });

    it('releases its signal listener if listen throws synchronously', async () => {
        const ac = new AbortController();
        const server = new RPCServer();
        try {
            await assert.rejects(server.listen(-1, '127.0.0.1', {signal: ac.signal}), RangeError);
            assert.equal(getEventListeners(ac.signal, 'abort').length, 0);
            assert.equal(server._httpServerAbortControllers.size, 0);
        } finally {
            await server.close();
        }
    });

    it('handles an already queued bind error when startup is aborted', async () => {
        const ac = new AbortController();
        const reason = new Error('cancelled while bind error was queued');
        const server = new RPCServer();
        const occupied = await server.listen(0);
        try {
            const listening = server.listen(occupied.address().port, undefined, {signal: ac.signal});
            ac.abort(reason);
            await assert.rejects(listening, error => error === reason);
            await setImmediate();
            assert.equal(getEventListeners(ac.signal, 'abort').length, 0);
            assert.equal(server._httpServerAbortControllers.size, 1);
        } finally {
            await server.close();
        }
    });
});
