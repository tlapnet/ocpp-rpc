import {RPCClient, RPCServer} from '../..';

// The runtime supplies defaults for every client option except identity.
const client = new RPCClient({identity: 'charger', endpoint: 'ws://localhost:9000'});
client.reconfigure({callTimeoutMs: 5000});
client.handle('Heartbeat', async () => ({currentTime: new Date().toISOString()}));
void client.call('Heartbeat', {}, {signal: new AbortController().signal});
void client.close();

const server = new RPCServer({protocols: ['ocpp1.6'], strictMode: true});
server.auth((accept, reject, handshake) => {
    if (handshake.identity) accept();
    else reject(403, 'Missing identity');
});
void server.close({});

// @ts-expect-error identity is required by the runtime
new RPCClient({endpoint: 'ws://localhost:9000'});
// @ts-expect-error known options must retain their types
client.reconfigure({callTimeoutMs: '5000'});
